/**
 * @jest-environment node
 *
 * Concurrency proof on the isolated SQL harness (embedded PostgreSQL, real parallel connections). Skipped unless
 * INGESTION_PG_TOOLS_DIR is set. Launch must be blocked if any of these fail.
 */
import { passed, runSqlHarness, sqlHarnessAvailable, type HarnessRun } from "./helpers/sql-harness";

const suite = sqlHarnessAvailable() ? describe : describe.skip;

suite("publisher concurrency on the isolated database", () => {
  let run: HarnessRun;
  beforeAll(() => {
    run = runSqlHarness();
  }, 300_000);

  it("gives every parallel caller the same event id for the same candidate and writes one event", () => {
    const hits = passed(run, /^same candidate in parallel: one event id for every caller$|^exactly one event\/link$/);
    expect(hits).toHaveLength(4);
    expect(hits.every((c) => c.ok)).toBe(true);
  });

  it("lets exactly one of several different candidates for the same slot publish, repeated over multiple rounds", () => {
    const rounds = passed(run, /^cross-candidate race round \d+: 1 winner, \d+ blocked, 1 event$/);
    expect(rounds.length).toBeGreaterThanOrEqual(10); // 5 rounds x 2 extension-schema variants
    expect(rounds.every((c) => c.ok)).toBe(true);
  });

  it("does not block legitimately different weekly dates at one address", () => {
    const hits = passed(run, /^different weekly dates at one address all publish$/);
    expect(hits).toHaveLength(2);
    expect(hits.every((c) => c.ok)).toBe(true);
  });

  it("completed with exit code 0", () => {
    expect(run.exitCode).toBe(0);
  });
});
