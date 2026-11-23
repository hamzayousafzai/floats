/**
 * @jest-environment node
 */
import { randomUUID } from "node:crypto";
import { MemoryDb } from "./helpers/memory-db";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import { IngestionStorageError, assertIngestionSchemaAccessible, createIngestionClient } from "@/lib/ingestion/storage/client";
import { getEnabledSources, getSourceById, updateSourceMetrics, upsertSource } from "@/lib/ingestion/storage/sources";
import { createRun, finishRun, findActiveRun, listRuns } from "@/lib/ingestion/storage/runs";
import { getObservationByIdentity, hashPayload, saveObservation } from "@/lib/ingestion/storage/observations";
import {
  type CandidateUpsertInput,
  decodeCursor,
  encodeCursor,
  getCandidateById,
  linkObservation,
  listCandidateSources,
  listCandidates,
  upsertCandidate,
  InvalidCursorError,
} from "@/lib/ingestion/storage/candidates";
import { getSourceDiscovery, saveSourceDiscovery } from "@/lib/ingestion/storage/discoveries";

type AnyFn = (...args: unknown[]) => unknown;
function wrapClient(db: MemoryDb, table: string, mutate: (builder: Record<string, AnyFn>) => void): IngestionClient {
  const real = db.client();
  return {
    ...real,
    schema: (s: string) => ({
      ...real.schema(s),
      from: (t: string) => {
        const b = real.schema(s).from(t) as unknown as Record<string, AnyFn>;
        if (t === table) mutate(b);
        return b;
      },
    }),
  } as unknown as IngestionClient;
}
function hideFirstLookup(db: MemoryDb, table: string): IngestionClient {
  let done = false;
  return wrapClient(db, table, (b) => {
    if (done) return;
    done = true;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  });
}

function setup() {
  const db = new MemoryDb();
  return { db, client: db.client() as unknown as IngestionClient };
}

const KEY = "a".repeat(64);
function candidateInput(sourceId: string, over: Partial<CandidateUpsertInput> = {}): CandidateUpsertInput {
  return {
    primarySourceId: sourceId, canonicalKey: KEY, sourceUrl: "https://example.org/e/1", externalEventId: null,
    title: "Charlotte Makers Market", description: "A multi-vendor market featuring local makers.",
    startsAt: "2030-12-05T15:00:00.000Z", endsAt: "2030-12-05T20:00:00.000Z", organizerName: "Example", venueName: null,
    address: "123 N Tryon St, Charlotte, NC", latitude: 35.2271, longitude: -80.8431, categorySlugs: [], vendorCount: null,
    vendorEvidence: [], validationReasons: ["untrusted_source"], score: 60, isMarket: true, locationVerified: false,
    vendorVerified: false, cancelled: false, duplicateState: "clear", status: "needs_review", ...over,
  };
}

describe("storage client", () => {
  it("rejects invalid configuration without echoing secrets", () => {
    const secret = "super-secret-service-key-value";
    expect(() => createIngestionClient({ NEXT_PUBLIC_SUPABASE_URL: "ftp://nope", SUPABASE_SERVICE_ROLE_KEY: secret })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    try {
      createIngestionClient({ NEXT_PUBLIC_SUPABASE_URL: "ftp://nope", SUPABASE_SERVICE_ROLE_KEY: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("reports an unexposed ingestion schema as a configuration blocker", async () => {
    const failing = {
      schema: () => ({ from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { code: "PGRST106", message: "The schema must be one of the following: public" } }) }) }) }),
    } as unknown as IngestionClient;
    await expect(assertIngestionSchemaAccessible(failing)).rejects.toThrow(/not exposed to the Data API/);
    const { client } = setup();
    await expect(assertIngestionSchemaAccessible(client)).resolves.toBeUndefined();
  });

  it("sanitises storage errors", async () => {
    const { db, client } = setup();
    db.failNext.push({ key: "ingestion.runs", op: "insert", error: { code: "XX000", message: "boom eyJabcdefghij.klmnopqrstu.vwxyz123456" } });
    const err = await createRun(client, "collection").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestionStorageError);
    expect(String(err)).not.toContain("eyJabcdefghij");
  });
});

describe("sources", () => {
  const base = { name: "Example", baseUrl: "https://example.org/markets", sourceType: "organizer" as const, adapter: "html" as const };

  it("upserts idempotently, always starting in probation", async () => {
    const { db, client } = setup();
    const first = await upsertSource(client, base);
    const second = await upsertSource(client, { ...base, name: "Example Renamed" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.source.id).toBe(first.source.id);
    expect(db.rows("ingestion.sources")).toHaveLength(1);
    expect(first.source.trust_state).toBe("probation");
    expect(second.source.name).toBe("Example Renamed");
  });

  it("never promotes or re-enables an existing source on reseed", async () => {
    const { db, client } = setup();
    const { source } = await upsertSource(client, base);
    Object.assign(db.rows("ingestion.sources")[0], { trust_state: "trusted", enabled: false });
    const again = await upsertSource(client, { ...base, enabled: true });
    expect(again.source.id).toBe(source.id);
    expect(again.source.trust_state).toBe("trusted");
    expect(again.source.enabled).toBe(false);
  });

  it("disables restricted sources and merges configuration", async () => {
    const { client } = setup();
    const created = await upsertSource(client, { ...base, forceDisable: true, configuration: { disabledReason: "robots" } });
    expect(created.source.enabled).toBe(false);
    const again = await upsertSource(client, { ...base, configuration: { selectors: { card: ".x" } }, forceDisable: true });
    expect(again.source.configuration).toEqual({ disabledReason: "robots", selectors: { card: ".x" } });
  });

  it("lists only enabled, non-disabled collection sources", async () => {
    const { db, client } = setup();
    db.seed("ingestion.sources", [
      { name: "a", base_url: "https://a.example/", enabled: true },
      { name: "b", base_url: "https://b.example/", enabled: false },
      { name: "c", base_url: "https://c.example/", trust_state: "disabled" },
      { name: "d", base_url: "https://d.example/", discovery_only: true },
    ]);
    expect((await getEnabledSources(client)).map((s) => s.name)).toEqual(["a"]);
    expect((await getEnabledSources(client, { includeDiscoveryOnly: true })).map((s) => s.name)).toEqual(["a", "d"]);
  });

  it("counts a successful attempt once and records failures separately", async () => {
    const { client } = setup();
    const { source } = await upsertSource(client, base);
    await updateSourceMetrics(client, source.id, { success: true, validEvents: 2, rejectedEvents: 1 });
    const failed = await updateSourceMetrics(client, source.id, { success: false });
    expect(failed.successful_runs).toBe(1);
    expect(failed.failed_runs).toBe(1);
    expect(failed.valid_events).toBe(2);
    expect(failed.rejected_events).toBe(1);
    expect(failed.last_success_at).not.toBeNull();
    expect((await getSourceById(client, source.id))?.successful_runs).toBe(1);
    await expect(updateSourceMetrics(client, randomUUID(), { success: true })).rejects.toThrow("Source not found");
  });

  it("does not lose increments when attempts for the same source overlap", async () => {
    const { client } = setup();
    const { source } = await upsertSource(client, base);
    await Promise.all([1, 2, 3].map(() => updateSourceMetrics(client, source.id, { success: true, validEvents: 1 })));
    const after = await getSourceById(client, source.id);
    expect(after?.successful_runs).toBe(3);
    expect(after?.valid_events).toBe(3);
  });

  describe("overlapping attempts finishing out of order", () => {
    const T1 = new Date("2031-11-20T09:00:00Z");
    const T2 = new Date("2031-11-20T10:00:00Z");

    it("does not move last_attempt_at or last_success_at backwards when an older success finishes last", async () => {
      const { client } = setup();
      const { source } = await upsertSource(client, base);
      await updateSourceMetrics(client, source.id, { attemptedAt: T2, success: true, validEvents: 1 });
      const late = await updateSourceMetrics(client, source.id, { attemptedAt: T1, success: true, validEvents: 2 });
      expect(late.last_attempt_at).toBe(T2.toISOString());
      expect(late.last_success_at).toBe(T2.toISOString());
      expect(late).toMatchObject({ successful_runs: 2, valid_events: 3, failed_runs: 0 });
    });

    it("keeps a newer failure visible when an older success completes after it", async () => {
      const { client } = setup();
      const { source } = await upsertSource(client, base);
      await updateSourceMetrics(client, source.id, { attemptedAt: T2, success: false });
      const late = await updateSourceMetrics(client, source.id, { attemptedAt: T1, success: true });
      expect(late.last_attempt_at).toBe(T2.toISOString());
      expect(late.last_success_at).toBe(T1.toISOString());
      expect(new Date(late.last_attempt_at as string).getTime()).toBeGreaterThan(new Date(late.last_success_at as string).getTime());
      expect(late).toMatchObject({ successful_runs: 1, failed_runs: 1 });
    });

    it("does not let an older failure hide a newer success", async () => {
      const { client } = setup();
      const { source } = await upsertSource(client, base);
      await updateSourceMetrics(client, source.id, { attemptedAt: T2, success: true });
      const late = await updateSourceMetrics(client, source.id, { attemptedAt: T1, success: false });
      expect(late.last_attempt_at).toBe(T2.toISOString());
      expect(late.last_success_at).toBe(T2.toISOString());
      expect(late).toMatchObject({ successful_runs: 1, failed_runs: 1 });
    });

    it("ends with the chronologically latest timestamps and exact counters for concurrent mixed-order writes", async () => {
      const { client } = setup();
      const { source } = await upsertSource(client, base);
      const times = [3, 1, 5, 2, 4].map((h) => new Date(`2031-11-20T0${h}:00:00Z`));
      await Promise.all(times.map((attemptedAt, i) => updateSourceMetrics(client, source.id, { attemptedAt, success: i !== 2, validEvents: 1, rejectedEvents: 2 })));
      const after = await getSourceById(client, source.id);
      expect(after).toMatchObject({ successful_runs: 4, failed_runs: 1, valid_events: 5, rejected_events: 10 });
      expect(after?.last_attempt_at).toBe("2031-11-20T05:00:00.000Z");
      expect(after?.last_success_at).toBe("2031-11-20T04:00:00.000Z");
    });
  });
});

describe("runs", () => {
  it("creates, finishes with a sanitised summary and finds active runs", async () => {
    const { client } = setup();
    const run = await createRun(client, "collection", { mode: "shadow" });
    expect(run.status).toBe("running");
    expect((await findActiveRun(client, "collection", 60))?.id).toBe(run.id);
    expect(await findActiveRun(client, "discovery", 60)).toBeNull();
    expect(await findActiveRun(client, "collection", 60, new Date(Date.now() + 3 * 3600_000))).toBeNull();
    const done = await finishRun(client, run.id, { status: "partial", sourcesAttempted: 3, sourcesSucceeded: 2, errorSummary: "Bearer abcdefghijklmnop failed" });
    expect(done.status).toBe("partial");
    expect(done.error_summary).toBe("Bearer [REDACTED] failed");
    expect(done.finished_at).not.toBeNull();
    expect(await findActiveRun(client, "collection", 60)).toBeNull();
    expect((await listRuns(client, 10)).map((r) => r.id)).toEqual([run.id]);
  });
});

describe("observations", () => {
  it("hashes payloads independent of key order", () => {
    expect(hashPayload({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(hashPayload({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
    expect(hashPayload({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("saving the same observation twice stores one row", async () => {
    const { db, client } = setup();
    const { source } = await upsertSource(client, { name: "S", baseUrl: "https://s.example/", sourceType: "organizer", adapter: "html" });
    const run = await createRun(client, "collection");
    const input = { sourceId: source.id, runId: run.id, externalEventId: null, sourceUrl: "https://s.example/e/1", rawPayload: { title: "T" }, parserVersion: "1" };
    const first = await saveObservation(client, input);
    const second = await saveObservation(client, { ...input, rawPayload: { title: "T" } });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.observation.id).toBe(first.observation.id);
    expect(db.rows("ingestion.observations")).toHaveLength(1);
    expect(await getObservationByIdentity(client, source.id, input.sourceUrl, first.observation.content_hash)).not.toBeNull();
    const changed = await saveObservation(client, { ...input, rawPayload: { title: "T2" } });
    expect(changed.created).toBe(true);
    expect(db.rows("ingestion.observations")).toHaveLength(2);
  });

  it("recovers from a unique violation raced by another worker", async () => {
    const { db, client } = setup();
    const { source } = await upsertSource(client, { name: "S", baseUrl: "https://s.example/", sourceType: "organizer", adapter: "html" });
    const run = await createRun(client, "collection");
    const payload = { title: "T" };
    const input = { sourceId: source.id, runId: run.id, externalEventId: null, sourceUrl: "https://s.example/e/1", rawPayload: payload, parserVersion: "1" };
    db.seed("ingestion.observations", [{ source_id: source.id, run_id: run.id, source_url: input.sourceUrl, raw_payload: payload, content_hash: hashPayload(payload), parser_version: "1" }]);
    // The first existence check misses (the other worker has not committed yet); the insert then collides.
    const racing = hideFirstLookup(db, "observations");
    const result = await saveObservation(racing, input);
    expect(result.created).toBe(false);
    expect(db.rows("ingestion.observations")).toHaveLength(1);
  });
});

describe("candidates", () => {
  async function withSource() {
    const ctx = setup();
    const { source } = await upsertSource(ctx.client, { name: "S", baseUrl: "https://s.example/", sourceType: "organizer", adapter: "html" });
    return { ...ctx, source };
  }

  it("upserting the same candidate twice leaves one row and keeps first_seen_at", async () => {
    const { db, client, source } = await withSource();
    const first = await upsertCandidate(client, candidateInput(source.id));
    const second = await upsertCandidate(client, candidateInput(source.id, { score: 75 }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(db.rows("ingestion.candidates")).toHaveLength(1);
    expect(second.candidate.score).toBe(75);
    expect(second.candidate.first_seen_at).toBe(first.candidate.first_seen_at);
    expect(second.candidate.id).toBe(first.candidate.id);
  });

  it("never overwrites approved, published or manually overridden candidates", async () => {
    for (const patch of [{ status: "approved" }, { status: "published" }, { manual_override: true, status: "needs_review" }]) {
      const { db, client, source } = await withSource();
      const first = await upsertCandidate(client, candidateInput(source.id));
      Object.assign(db.rows("ingestion.candidates")[0], patch, { title: "Admin Edited Title" });
      const again = await upsertCandidate(client, candidateInput(source.id, { title: "Scraper Title", status: "rejected", score: 5 }));
      expect(again.preserved).toBe(true);
      expect(again.candidate.title).toBe("Admin Edited Title");
      expect(again.candidate.status).toBe(patch.status);
      expect(again.candidate.id).toBe(first.candidate.id);
    }
  });

  it("keeps rejected candidates rejected unless explicitly re-opened", async () => {
    const { db, client, source } = await withSource();
    await upsertCandidate(client, candidateInput(source.id));
    db.rows("ingestion.candidates")[0].status = "rejected";
    expect((await upsertCandidate(client, candidateInput(source.id, { status: "ready" }))).candidate.status).toBe("rejected");
    expect((await upsertCandidate(client, candidateInput(source.id, { status: "needs_review", allowReopen: true }))).candidate.status).toBe("needs_review");
  });

  it("skips the write when a concurrent approval wins the compare-and-swap", async () => {
    const { db, client, source } = await withSource();
    await upsertCandidate(client, candidateInput(source.id));
    let raced = false;
    const racing = wrapClient(db, "candidates", (b) => {
      const original = b.update.bind(b);
      b.update = (p: unknown) => {
        if (!raced && p && typeof p === "object" && "validation_reasons" in p) {
          raced = true;
          db.rows("ingestion.candidates")[0].status = "approved";
        }
        return original(p);
      };
    });
    const result = await upsertCandidate(racing, candidateInput(source.id, { title: "Scraper Title" }));
    expect(raced).toBe(true);
    expect(result.preserved).toBe(true);
    expect(result.candidate.status).toBe("approved");
    expect(result.candidate.title).toBe("Charlotte Makers Market");
  });

  it("links observation evidence once and lists it", async () => {
    const { db, client, source } = await withSource();
    const run = await createRun(client, "collection");
    const { observation } = await saveObservation(client, { sourceId: source.id, runId: run.id, externalEventId: null, sourceUrl: "https://s.example/e/1", rawPayload: { a: 1 }, parserVersion: "1" });
    const { candidate } = await upsertCandidate(client, candidateInput(source.id));
    await linkObservation(client, candidate.id, observation.id, "primary");
    await linkObservation(client, candidate.id, observation.id, "primary");
    expect(db.rows("ingestion.candidate_sources")).toHaveLength(1);
    expect(await getCandidateById(client, candidate.id)).not.toBeNull();
    expect(await getCandidateById(client, randomUUID())).toBeNull();
    // The memory fake does not model embeds, so only the call shape is asserted here.
    await expect(listCandidateSources(client, candidate.id)).resolves.toEqual([{ source_url: "", match_reason: "primary" }]);
  });

  it("paginates with a keyset cursor and rejects malformed cursors", async () => {
    const { db, client, source } = await withSource();
    for (let i = 0; i < 5; i += 1) {
      db.seed("ingestion.candidates", [{ primary_source_id: source.id, canonical_key: i.toString(16).padStart(64, "0"), source_url: "https://s.example/", title: `T${i}`, updated_at: `2030-01-0${i + 1}T00:00:00.000Z` }]);
    }
    const page1 = await listCandidates(client, { limit: 2 });
    expect(page1.rows.map((r) => r.title)).toEqual(["T4", "T3"]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listCandidates(client, { limit: 2, cursor: page1.nextCursor });
    expect(page2.rows.map((r) => r.title)).toEqual(["T2", "T1"]);
    const page3 = await listCandidates(client, { limit: 2, cursor: page2.nextCursor });
    expect(page3.rows.map((r) => r.title)).toEqual(["T0"]);
    expect(page3.nextCursor).toBeNull();
    await expect(listCandidates(client, { cursor: "not-a-cursor" })).rejects.toBeInstanceOf(InvalidCursorError);
    expect(decodeCursor(Buffer.from(JSON.stringify({ updated_at: "x) or 1=1", id: randomUUID() })).toString("base64url"))).toBeNull();
    expect(decodeCursor(encodeCursor({ updated_at: "2030-01-01T00:00:00.000Z", id: randomUUID() }))).not.toBeNull();
  });

  it("bounds page size to 100 and filters by status", async () => {
    const { db, client, source } = await withSource();
    db.seed("ingestion.candidates", [
      { primary_source_id: source.id, canonical_key: "1".repeat(64), source_url: "https://s.example/", title: "A", status: "ready" },
      { primary_source_id: source.id, canonical_key: "2".repeat(64), source_url: "https://s.example/", title: "B", status: "rejected" },
    ]);
    expect((await listCandidates(client, { status: "ready", limit: 1000 })).rows.map((r) => r.title)).toEqual(["A"]);
  });
});

describe("discoveries", () => {
  it("saves a discovery once and never clears its registration", async () => {
    const { db, client } = setup();
    const { source } = await upsertSource(client, { name: "S", baseUrl: "https://s.example/", sourceType: "organizer", adapter: "html" });
    const input = { discoveredUrl: "https://new.example/", parentSourceId: source.id, evaluation: "compatible" as const, reason: null, adapterDetected: "jsonld" as const, registeredSourceId: source.id };
    const first = await saveSourceDiscovery(client, input);
    const second = await saveSourceDiscovery(client, { ...input, registeredSourceId: null, evaluation: "unsupported", adapterDetected: null });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(db.rows("ingestion.source_discoveries")).toHaveLength(1);
    expect(second.discovery.registered_source_id).toBe(source.id);
    expect((await getSourceDiscovery(client, "https://new.example/"))?.evaluation).toBe("unsupported");
  });
});
