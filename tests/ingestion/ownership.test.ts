/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import { passed, runSqlHarness, sqlHarnessAvailable, type HarnessRun } from "./helpers/sql-harness";
import { InvalidChangeError, canAutomateUpdate, isHostOwned, ownershipOf, planSourceChange, toChangePayload } from "@/lib/ingestion/publication/ownership";
import { archiveCancelledEvent, updateImportedEvent } from "@/lib/ingestion/publication/update-imported-event";
import type { IngestionClient } from "@/lib/ingestion/storage/client";

const CONFIG = { centerLat: 35.2271, centerLng: -80.8431, radiusMiles: 35 };
const EVENT = "11111111-2222-4333-8444-555555555555";

describe("ownership rules", () => {
  it("only ingestion-managed events may be automated", () => {
    expect(canAutomateUpdate("ingestion")).toBe(true);
    expect(canAutomateUpdate("manual")).toBe(false);
    expect(canAutomateUpdate("claimed")).toBe(false);
  });

  it("treats any host relationship as ownership by someone else", () => {
    expect(isHostOwned({})).toBe(false);
    for (const key of ["org_id", "vendor_id", "market_id", "series_id"] as const) expect(isHostOwned({ [key]: "x" })).toBe(true);
    expect(ownershipOf({ management_state: "ingestion", org_id: "x" })).toBe("claimed");
    expect(ownershipOf({ management_state: "manual" })).toBe("manual");
    expect(ownershipOf({ management_state: "ingestion" })).toBe("ingestion");
  });
});

describe("toChangePayload", () => {
  it("maps verified fields to column names and normalises values", () => {
    expect(toChangePayload({ title: "  New Title  ", startsAt: "2031-12-06T15:00:00Z", latitude: 35.2, longitude: -80.8 })).toEqual({
      title: "New Title",
      starts_at: "2031-12-06T15:00:00.000Z",
      latitude: 35.2,
      longitude: -80.8,
    });
  });

  it("rejects fields outside the allow-list instead of dropping them", () => {
    for (const bad of [{ status: "archived" }, { org_id: "x" }, { vendor_id: "x" }, { imageUrl: "https://x" }, { is_featured: true }]) {
      expect(() => toChangePayload(bad as never)).toThrow(InvalidChangeError);
    }
  });

  it("rejects malformed values", () => {
    expect(() => toChangePayload({ title: "" })).toThrow(InvalidChangeError);
    expect(() => toChangePayload({ latitude: Number.NaN })).toThrow(InvalidChangeError);
    expect(() => toChangePayload({ startsAt: "not a date" })).toThrow(InvalidChangeError);
    expect(() => toChangePayload({ title: "x".repeat(10_001) })).toThrow(InvalidChangeError);
  });
});

describe("planSourceChange: disappearance is not cancellation", () => {
  const base = { eventPresent: true, cancelled: false, cancellationText: null } as const;

  it("never archives when the source could not be read", () => {
    for (const fetchOutcome of ["not_found", "error", "robots_denied"] as const) {
      expect(planSourceChange({ ...base, fetchOutcome, eventPresent: false, cancelled: true, cancellationText: "This market is cancelled" })).toEqual({ action: "none", reason: "source_unreachable" });
    }
  });

  it("never archives an event that merely vanished from a listing", () => {
    expect(planSourceChange({ ...base, fetchOutcome: "ok", eventPresent: false })).toEqual({ action: "none", reason: "event_missing_not_cancellation" });
  });

  it("requires an explicit cancellation flag and quoted evidence", () => {
    expect(planSourceChange({ ...base, fetchOutcome: "ok", cancelled: true, cancellationText: null })).toMatchObject({ action: "none" });
    expect(planSourceChange({ ...base, fetchOutcome: "ok", cancelled: true, cancellationText: "short" })).toMatchObject({ action: "none" });
    expect(planSourceChange({ ...base, fetchOutcome: "ok", cancelled: true, cancellationText: "This event has been cancelled." })).toEqual({ action: "archive", evidence: "This event has been cancelled." });
  });

  it("plans a field update only when there are changes", () => {
    expect(planSourceChange({ ...base, fetchOutcome: "ok", changes: { title: "A New Title" } })).toEqual({ action: "update", changes: { title: "A New Title" } });
    expect(planSourceChange({ ...base, fetchOutcome: "ok", changes: {} })).toEqual({ action: "none", reason: "no_changes" });
  });
});

describe("update RPC wrapper", () => {
  function setup(result: { data?: unknown; error?: { code: string; message: string } }) {
    const db = new MemoryDb();
    db.rpcHandlers.set("ingestion.update_imported_event", () => result);
    return { db, deps: { client: db.client() as unknown as IngestionClient, config: CONFIG } };
  }

  it("sends only mapped fields and config limits", async () => {
    const { db, deps } = setup({ data: "updated" });
    expect(await updateImportedEvent(deps, EVENT, { title: "New Title Here" })).toEqual({ eventId: EVENT, outcome: "updated", changed: true });
    expect(db.rpcCalls[0].args).toEqual({ p_event_id: EVENT, p_changes: { title: "New Title Here" }, p_cancellation_evidence: null, p_center_lat: 35.2271, p_center_lng: -80.8431, p_radius_miles: 35 });
  });

  it("reports blocked outcomes as unchanged production data", async () => {
    for (const outcome of ["not_managed", "host_owned", "manually_modified", "possible_duplicate", "unchanged"]) {
      const { deps } = setup({ data: outcome });
      expect((await updateImportedEvent(deps, EVENT, { title: "New Title Here" })).changed).toBe(false);
    }
  });

  it("archives with evidence and no field changes", async () => {
    const { db, deps } = setup({ data: "archived" });
    expect(await archiveCancelledEvent(deps, EVENT, "Organizer page: this market is cancelled")).toMatchObject({ outcome: "archived", changed: true });
    expect(db.rpcCalls[0].args).toMatchObject({ p_changes: {}, p_cancellation_evidence: "Organizer page: this market is cancelled" });
  });

  it("fails closed on SQL errors, unknown outcomes and malformed ids, and writes nothing", async () => {
    await expect(updateImportedEvent(setup({ error: { code: "P0001", message: "Service role required" } }).deps, EVENT, { title: "New Title Here" })).rejects.toThrow("Imported event update failed");
    await expect(updateImportedEvent(setup({ data: "surprise" }).deps, EVENT, { title: "New Title Here" })).rejects.toThrow("unknown outcome");
    const { db, deps } = setup({ data: "updated" });
    await expect(updateImportedEvent(deps, "not-a-uuid", { title: "New Title Here" })).rejects.toThrow("Invalid event id");
    await expect(updateImportedEvent(deps, EVENT, { status: "archived" } as never)).rejects.toThrow(InvalidChangeError);
    expect(db.rpcCalls).toHaveLength(0);
  });
});

const harnessSuite = sqlHarnessAvailable() ? describe : describe.skip;

harnessSuite("ownership-safe updates on the isolated database", () => {
  let run: HarnessRun;
  beforeAll(() => {
    run = runSqlHarness();
  }, 300_000);

  const all = (pattern: RegExp) => {
    const hits = passed(run, pattern);
    expect(hits).toHaveLength(2); // both extension-schema variants
    expect(hits.every((c) => c.ok)).toBe(true);
  };

  it("applies safe, audited updates to ingestion-managed events only", () => {
    all(/^verified update applies to an ingestion-managed event$/);
    all(/^event and candidate mirror the update$/);
    all(/^update is audited with before and after$/);
    all(/^repeating the same update is a no-op$/);
    all(/^update never changes the owner\/vendor relationships$/);
    all(/^unsupported field refused: status$/);
    all(/^unsupported field refused: org_id$/);
  });

  it("blocks manual, claimed, host-owned and hand-edited events", () => {
    all(/^manual-state event is never updated$/);
    all(/^claimed-state event is never updated or archived$/);
    all(/^host-owned event is detected, not updated, and automation disabled$/);
    all(/^host ownership is never cleared by a later update$/);
    all(/^manually edited event is detected, not overwritten, and switched to manual$/);
    all(/^a manually created event without provenance is never touched$/);
  });

  it("archives only on verified cancellation and audits it", () => {
    all(/^archival requires substantive evidence$/);
    all(/^archival cannot be combined with field changes$/);
    all(/^an event with no evidence is never archived by an ordinary update$/);
    all(/^verified cancellation archives the event$/);
    all(/^archival is audited and marks the candidate cancelled$/);
  });

  it("enforces hard gates, radius, duplicates, started events, roles and concurrency", () => {
    all(/^update with a short description is refused$/);
    all(/^update outside the radius is refused$/);
    all(/^update onto another event's slot is refused$/);
    all(/^events that already started are not updated$/);
    all(/^update refuses non-service JWT roles$/);
    all(/^update_imported_event EXECUTE only for service_role$/);
    all(/^parallel updates to one event all succeed and stay consistent$/);
  });
});
