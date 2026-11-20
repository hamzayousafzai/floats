import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface HarnessCheck {
  ok: boolean;
  variant: string;
  name: string;
}

export interface HarnessRun {
  exitCode: number | null;
  checks: HarnessCheck[];
  summary: string | null;
}

/** The SQL harness needs the locally installed embedded PostgreSQL tools; tests that use it are skipped otherwise. */
export function sqlHarnessAvailable(): boolean {
  const dir = process.env.INGESTION_PG_TOOLS_DIR;
  return Boolean(dir) && existsSync(dir as string);
}

/**
 * Runs `db-harness/verify-sql.mjs`: the real migration and publisher SQL on an isolated embedded PostgreSQL
 * (a substitute for Supabase local: no PostgREST, GoTrue or real PostGIS).
 */
export function runSqlHarness(): HarnessRun {
  const script = path.join(__dirname, "..", "db-harness", "verify-sql.mjs");
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: process.env, timeout: 240_000, maxBuffer: 64 * 1024 * 1024 });
  const checks: HarnessCheck[] = [];
  let summary: string | null = null;
  for (const line of (result.stdout ?? "").split(/\r?\n/)) {
    const m = /^(PASS|FAIL) \[(\w+)\] (.*)$/.exec(line);
    if (m) checks.push({ ok: m[1] === "PASS", variant: m[2], name: m[3].trim() });
    const s = /^(\d+)\/(\d+) checks passed$/.exec(line.trim());
    if (s) summary = line.trim();
  }
  return { exitCode: result.status, checks, summary };
}

export function passed(run: HarnessRun, namePattern: RegExp): HarnessCheck[] {
  return run.checks.filter((c) => namePattern.test(c.name));
}
