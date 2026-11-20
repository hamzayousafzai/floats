/**
 * @jest-environment node
 */
import { MemoryDb } from "./helpers/memory-db";
import type { IngestionClient } from "@/lib/ingestion/storage/client";
import { applyRetention } from "@/lib/ingestion/storage/retention";

const NOW = new Date("2031-11-20T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const hash = (n: number) => n.toString(16).padStart(64, "0");

function setup() {
  const db = new MemoryDb();
  const client = db.client() as unknown as IngestionClient;
  let n = 0;
  const run = (ageDays: number, status = "succeeded") => db.seed("ingestion.runs", [{ run_type: "collection", status, started_at: daysAgo(ageDays) }])[0] as { id: string };
  const observation = (runId: string, ageDays: number) => {
    n += 1;
    return db.seed("ingestion.observations", [{ source_id: "s", run_id: runId, source_url: `https://a.example.test/${n}`, raw_payload: {}, content_hash: hash(n), parser_version: "1", observed_at: daysAgo(ageDays) }])[0] as { id: string };
  };
  const candidate = (status: string, extra: Record<string, unknown> = {}) => {
    n += 1;
    return db.seed("ingestion.candidates", [{ primary_source_id: "s", canonical_key: hash(1000 + n), title: "T", status, ...extra }])[0] as { id: string };
  };
  const link = (candidateId: string, observationId: string) => db.seed("ingestion.candidate_sources", [{ candidate_id: candidateId, observation_id: observationId, match_reason: "canonical_key" }]);
  const ids = (key: string) => (db.rows(key) as unknown as { id: string }[]).map((r) => r.id);
  return { db, client, run, observation, candidate, link, ids };
}

describe("retention: raw observations", () => {
  it("deletes only expired observations that are not evidence for live or reviewed candidates", async () => {
    const t = setup();
    const r = t.run(200);
    const fresh = t.observation(r.id, 10);
    const expiredLoose = t.observation(r.id, 100);
    const expiredRejected = t.observation(r.id, 100);
    const expiredReady = t.observation(r.id, 100);
    const expiredReview = t.observation(r.id, 100);
    const expiredPublished = t.observation(r.id, 400);
    const expiredReviewedRejected = t.observation(r.id, 100);
    t.link(t.candidate("rejected").id, expiredRejected.id);
    t.link(t.candidate("ready").id, expiredReady.id);
    t.link(t.candidate("needs_review").id, expiredReview.id);
    t.link(t.candidate("rejected", { published_event_id: "e1" }).id, expiredPublished.id);
    const reviewed = t.candidate("rejected");
    t.link(reviewed.id, expiredReviewedRejected.id);
    t.db.seed("ingestion.reviews", [{ candidate_id: reviewed.id, reviewer_id: "u", decision: "reject", reason: "not a market" }]);

    const report = await applyRetention(t.client, { now: NOW, dryRun: false });
    expect(report).toMatchObject({ observationsDeleted: 2, observationsProtected: 4 });
    const remaining = t.ids("ingestion.observations");
    expect(remaining).toEqual(expect.arrayContaining([fresh.id, expiredReady.id, expiredReview.id, expiredPublished.id, expiredReviewedRejected.id]));
    expect(remaining).not.toContain(expiredLoose.id);
    expect(remaining).not.toContain(expiredRejected.id);
  });

  it("is a dry run unless explicitly told otherwise", async () => {
    const t = setup();
    const r = t.run(10);
    t.observation(r.id, 120);
    const report = await applyRetention(t.client, { now: NOW });
    expect(report).toMatchObject({ dryRun: true, observationsDeleted: 1 });
    expect(t.db.rows("ingestion.observations")).toHaveLength(1);
    expect((await applyRetention(t.client, { now: NOW, dryRun: undefined })).dryRun).toBe(true);
  });

  it("pages through more observations than one batch, including protected ones", async () => {
    const t = setup();
    const r = t.run(10);
    const keep = t.candidate("ready");
    for (let i = 0; i < 7; i += 1) {
      const o = t.observation(r.id, 100 + i);
      if (i % 3 === 0) t.link(keep.id, o.id);
    }
    const report = await applyRetention(t.client, { now: NOW, dryRun: false, batchSize: 2 });
    expect(report).toMatchObject({ observationsExamined: 7, observationsDeleted: 4, observationsProtected: 3 });
    expect(t.db.rows("ingestion.observations")).toHaveLength(3);
  });

  it("bounds the number of rows examined in one invocation", async () => {
    const t = setup();
    const r = t.run(10);
    for (let i = 0; i < 6; i += 1) t.observation(r.id, 120);
    const report = await applyRetention(t.client, { now: NOW, dryRun: false, batchSize: 2, maxExamined: 4 });
    expect(report.observationsExamined).toBeLessThanOrEqual(4);
    expect(t.db.rows("ingestion.observations").length).toBeGreaterThanOrEqual(2);
  });
});

describe("retention: runs and everything else", () => {
  it("deletes old finished runs only when no retained evidence references them", async () => {
    const t = setup();
    const oldFree = t.run(400);
    const oldReferenced = t.run(400);
    const oldRunning = t.run(400, "running");
    const recent = t.run(200);
    const evidence = t.observation(oldReferenced.id, 100);
    t.link(t.candidate("ready").id, evidence.id);

    const report = await applyRetention(t.client, { now: NOW, dryRun: false });
    expect(report).toMatchObject({ runsDeleted: 1, runsProtected: 1 });
    const remaining = t.ids("ingestion.runs");
    expect(remaining).not.toContain(oldFree.id);
    expect(remaining).toEqual(expect.arrayContaining([oldReferenced.id, oldRunning.id, recent.id]));
  });

  it("frees a run once its expired evidence is removed in the same pass", async () => {
    const t = setup();
    const r = t.run(400);
    t.observation(r.id, 400);
    const report = await applyRetention(t.client, { now: NOW, dryRun: false });
    expect(report).toMatchObject({ observationsDeleted: 1, runsDeleted: 1 });
  });

  it("never touches candidates, reviews, audit rows, sources or public events", async () => {
    const t = setup();
    const r = t.run(400);
    const o = t.observation(r.id, 400);
    const c = t.candidate("rejected");
    t.link(c.id, o.id);
    t.db.seed("ingestion.reviews", [{ candidate_id: c.id, reviewer_id: "u", decision: "reject", reason: "x" }]);
    t.db.seed("ingestion.publication_audit", [{ candidate_id: c.id, action: "blocked" }]);
    t.db.seed("ingestion.sources", [{ name: "S", base_url: "https://s.example.test" }]);
    t.db.seed("public.events", [{ title: "Real event", status: "published" }]);
    t.db.seed("public.event_ingestion_links", [{ event_id: "e", candidate_id: c.id, source_id: "s", management_state: "ingestion" }]);
    const counts = () => ["ingestion.candidates", "ingestion.reviews", "ingestion.publication_audit", "ingestion.sources", "public.events", "public.event_ingestion_links"].map((k) => t.db.rows(k).length);
    const before = counts();
    await applyRetention(t.client, { now: NOW, dryRun: false });
    expect(counts()).toEqual(before);
  });

  it("refuses windows shorter than the policy", async () => {
    const t = setup();
    await expect(applyRetention(t.client, { now: NOW, rawDays: 30, dryRun: false })).rejects.toThrow(/cannot be shorter/);
    await expect(applyRetention(t.client, { now: NOW, runDays: 100, dryRun: false })).rejects.toThrow(/cannot be shorter/);
  });

  it("surfaces database errors instead of deleting blindly", async () => {
    const t = setup();
    const r = t.run(10);
    t.observation(r.id, 120);
    t.db.failNext.push({ key: "ingestion.candidate_sources", op: "select", error: { code: "XX000", message: "db down" } });
    await expect(applyRetention(t.client, { now: NOW, dryRun: false })).rejects.toThrow(/Failed to load evidence links/);
    expect(t.db.rows("ingestion.observations")).toHaveLength(1);
  });
});
