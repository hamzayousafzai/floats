/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import { publishCandidate, type PublicationConfig } from "@/lib/ingestion/publication/publish-candidate";
import { recordShadowDecision } from "@/lib/ingestion/publication/record-shadow-decision";
import type { CandidateRow } from "@/lib/ingestion/storage/rows";
import type { IngestionClient } from "@/lib/ingestion/storage/client";

const LIVE: PublicationConfig = { centerLat: 35.2271, centerLng: -80.8431, radiusMiles: 35, horizonDays: 60, autoPublishScore: 90, publishMode: "live" };
const SHADOW: PublicationConfig = { ...LIVE, publishMode: "shadow" };
const EVENT_ID = "11111111-2222-4333-8444-555555555555";

function setup(candidate: Record<string, unknown> = {}, config: PublicationConfig = LIVE) {
  const db = new MemoryDb();
  const [source] = db.seed("ingestion.sources", [{ name: "A", base_url: "https://a.example.test", source_type: "organizer", adapter: "html", trust_state: "trusted" }]);
  const [row] = db.seed("ingestion.candidates", [
    { primary_source_id: (source as { id: string }).id, canonical_key: "k1", source_url: "https://a.example.test/e", title: "Example Makers Market", status: "ready", score: 95, published_event_id: null, approved_by: null, ...candidate },
  ]);
  const id = (row as { id: string }).id;
  const client = db.client() as unknown as IngestionClient;
  const run = (manual = false) => publishCandidate({ client, config }, id, manual);
  const audits = () => db.rows("ingestion.publication_audit") as unknown as { action: string; reason: string }[];
  return { db, id, client, run, audits };
}

function failWith(db: MemoryDb, message: string) {
  db.rpcHandlers.set("ingestion.publish_candidate", () => ({ error: { code: "P0001", message } }));
}

describe("publishCandidate: shadow mode", () => {
  it("records a shadow_approved audit row and performs no publisher call or production write", async () => {
    const { db, run, audits } = setup({}, SHADOW);
    const result = await run();
    expect(result).toMatchObject({ status: "shadow", reason: "shadow_mode", eventId: null });
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.rows("public.events")).toHaveLength(0);
    expect(db.rows("public.event_ingestion_links")).toHaveLength(0);
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ action: "shadow_approved", reason: "shadow_mode" });
  });

  it("does not repeat the shadow audit row for the same candidate", async () => {
    const { run, audits } = setup({}, SHADOW);
    await run();
    await run();
    expect(audits()).toHaveLength(1);
  });

  it("recordShadowDecision reports whether it recorded", async () => {
    const { client, db } = setup({}, SHADOW);
    const candidate = db.rows("ingestion.candidates")[0] as unknown as CandidateRow;
    expect((await recordShadowDecision(client, candidate)).recorded).toBe(true);
    expect((await recordShadowDecision(client, candidate)).recorded).toBe(false);
  });

  it("does not shadow-approve candidates that are not ready or below the score threshold", async () => {
    const review = setup({ status: "needs_review" }, SHADOW);
    expect(await review.run()).toMatchObject({ status: "blocked", reason: "not_ready" });
    const low = setup({ score: 80 }, SHADOW);
    expect(await low.run()).toMatchObject({ status: "blocked", reason: "score_below_threshold" });
    expect(review.audits()).toHaveLength(0);
    expect(low.audits()).toHaveLength(0);
  });

  it("allows an explicit admin-approved manual publish even in shadow mode", async () => {
    const { db, run } = setup({ status: "approved", approved_by: "admin-1" }, SHADOW);
    db.rpcHandlers.set("ingestion.publish_candidate", () => ({ data: EVENT_ID }));
    expect(await run(true)).toMatchObject({ status: "published", eventId: EVENT_ID });
    expect(db.rpcCalls[0].args).toMatchObject({ p_manual: true });
  });
});

describe("publishCandidate: live mode", () => {
  it("publishes a trusted ready candidate through the SQL publisher with configured limits", async () => {
    const { db, id, run } = setup();
    db.rpcHandlers.set("ingestion.publish_candidate", () => ({ data: EVENT_ID }));
    expect(await run()).toEqual({ candidateId: id, eventId: EVENT_ID, status: "published", reason: "published" });
    expect(db.rpcCalls).toEqual([
      { name: "ingestion.publish_candidate", args: { p_candidate_id: id, p_min_score: 90, p_center_lat: 35.2271, p_center_lng: -80.8431, p_radius_miles: 35, p_horizon_days: 60, p_manual: false } },
    ]);
  });

  it("returns the existing event on replay without calling the publisher again", async () => {
    const { db, run } = setup({ published_event_id: EVENT_ID, status: "published" });
    const result = await run();
    expect(result).toMatchObject({ status: "published", eventId: EVENT_ID });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("never auto-publishes probation, disabled, incomplete or cancelled candidates (publisher refusals are reported and audited)", async () => {
    const cases: [string, string, string][] = [
      ["Source unavailable", "source_unavailable", "blocked"],
      ["Automatic publication not permitted", "automatic_not_permitted", "blocked"],
      ["Candidate failed hard publication gates", "hard_gates_failed", "blocked"],
    ];
    for (const [message, reason, action] of cases) {
      const { db, run, audits } = setup();
      failWith(db, message);
      expect(await run()).toEqual(expect.objectContaining({ status: "blocked", reason, eventId: null }));
      expect(audits()).toEqual([expect.objectContaining({ action, reason })]);
      expect(db.rows("public.events")).toHaveLength(0);
    }
  });

  it("reports out-of-radius refusals", async () => {
    const { db, run, audits } = setup();
    failWith(db, "Event is outside radius");
    expect(await run()).toMatchObject({ status: "blocked", reason: "outside_radius" });
    expect(audits()[0].action).toBe("blocked");
  });

  it("records duplicate refusals as skipped_duplicate", async () => {
    for (const [message, reason] of [
      ["Existing published event identity", "existing_identity"],
      ["Possible existing production duplicate", "possible_duplicate"],
    ]) {
      const { db, run, audits } = setup();
      failWith(db, message);
      expect(await run()).toMatchObject({ status: "blocked", reason });
      expect(audits()).toEqual([expect.objectContaining({ action: "skipped_duplicate", reason })]);
    }
  });

  it("maps other documented publisher errors to reasons", async () => {
    for (const [message, reason] of [
      ["Service role required", "service_role_required"],
      ["Invalid publication configuration", "invalid_configuration"],
      ["Candidate requires recorded admin approval", "approval_required"],
    ]) {
      const { db, run } = setup();
      failWith(db, message);
      expect(await run()).toMatchObject({ status: "blocked", reason });
    }
  });

  it("rethrows unexpected publisher errors instead of masking them", async () => {
    const { db, run, audits } = setup();
    failWith(db, "connection reset");
    await expect(run()).rejects.toThrow("Unexpected publication failure");
    expect(audits()).toHaveLength(0);
  });

  it("rejects a publisher result that is not a uuid", async () => {
    const { db, run } = setup();
    db.rpcHandlers.set("ingestion.publish_candidate", () => ({ data: "not-a-uuid" }));
    await expect(run()).rejects.toThrow("invalid event id");
  });

  it("returns blocked for an unknown candidate", async () => {
    const { client } = setup();
    expect(await publishCandidate({ client, config: LIVE }, "00000000-0000-4000-8000-000000000000")).toMatchObject({ status: "blocked", reason: "candidate_not_found" });
  });
});

describe("publishCandidate: manual path", () => {
  it("requires an approved candidate with a recorded approver before calling the publisher", async () => {
    const pending = setup({ status: "needs_review" });
    expect(await pending.run(true)).toMatchObject({ status: "blocked", reason: "approval_required" });
    const noApprover = setup({ status: "approved", approved_by: null });
    expect(await noApprover.run(true)).toMatchObject({ status: "blocked", reason: "approval_required" });
    expect(pending.db.rpcCalls).toHaveLength(0);
    expect(noApprover.db.rpcCalls).toHaveLength(0);
  });

  it("still lets the SQL publisher refuse duplicates and out-of-radius events for approved candidates", async () => {
    const { db, run, audits } = setup({ status: "approved", approved_by: "admin-1" });
    failWith(db, "Possible existing production duplicate");
    expect(await run(true)).toMatchObject({ status: "blocked", reason: "possible_duplicate" });
    expect(audits()[0]).toMatchObject({ action: "skipped_duplicate" });
  });
});
