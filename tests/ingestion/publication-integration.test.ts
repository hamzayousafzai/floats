/**
 * @jest-environment node
 *
 * Runs the publisher scenarios against the isolated SQL harness (embedded PostgreSQL). Skipped unless
 * INGESTION_PG_TOOLS_DIR points at the installed embedded PostgreSQL tools. This is a substitute for
 * `supabase start` and is NOT real Supabase/PostGIS; see the audit and runbook documents.
 */
import { passed, runSqlHarness, sqlHarnessAvailable, type HarnessRun } from "./helpers/sql-harness";

const suite = sqlHarnessAvailable() ? describe : describe.skip;

suite("publisher SQL on the isolated database", () => {
  let run: HarnessRun;
  beforeAll(() => {
    run = runSqlHarness();
  }, 300_000);

  const requireAll = (pattern: RegExp, minimum = 1) => {
    const hits = passed(run, pattern);
    expect(hits.length).toBeGreaterThanOrEqual(minimum);
    expect(hits.filter((c) => !c.ok)).toEqual([]);
  };

  it("applies the migration and every check passes in both extension-schema variants", () => {
    expect(run.exitCode).toBe(0);
    expect(run.checks.length).toBeGreaterThan(100);
    expect(run.checks.filter((c) => !c.ok)).toEqual([]);
    expect(run.summary).toMatch(/^(\d+)\/\1 checks passed$/);
  });

  it("publishes a trusted candidate once, with provenance, and replays to the same event", () => {
    requireAll(/^trusted ready candidate publishes$/, 2);
    requireAll(/^provenance link and category created$/, 2);
    requireAll(/^replay returns same event id, no second event$/, 2);
  });

  it("blocks probation, disabled, incomplete, cancelled, duplicate, out-of-radius and other unsafe candidates without writing events", () => {
    for (const label of ["probation source automatic", "disabled source", "short description", "short address", "cancelled", "possible duplicate", "outside radius \\(Atlanta\\)", "beyond horizon", "past start"]) {
      requireAll(new RegExp(`^blocked: ${label}$`), 2);
    }
    requireAll(/^no event written: /, 20);
  });

  it("requires recorded admin approval for the manual path and never bypasses hard gates", () => {
    requireAll(/^manual path requires approval$/, 2);
    requireAll(/^manual path requires approver id$/, 2);
    requireAll(/^manual approval never bypasses hard gates$/, 2);
  });

  it("rolls back every write when publication fails midway, then succeeds after the failure clears", () => {
    requireAll(/^rollback leaves no event, link or audit and candidate unchanged$/, 2);
    requireAll(/^candidate publishes after the transient failure clears$/, 2);
    requireAll(/^fails closed when geom is not populated$/, 2);
  });

  it("keeps private tables and the publisher unreachable for anon and authenticated roles", () => {
    requireAll(/^no anon\/authenticated\/PUBLIC table grants$/, 2);
    requireAll(/^EXECUTE only for service_role$/, 2);
    requireAll(/^non-service JWT role refused inside function$/, 2);
  });
});
