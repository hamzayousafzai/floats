import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
export interface MemoryError {
  code: string;
  message: string;
}
interface Result {
  data: unknown;
  error: MemoryError | null;
}

const DEFAULTS: Record<string, () => Row> = {
  "ingestion.sources": () => ({
    trust_state: "probation", enabled: true, discovery_only: false, crawl_delay_ms: 2000, configuration: {},
    valid_events: 0, rejected_events: 0, failed_runs: 0, successful_runs: 0, last_success_at: null, last_attempt_at: null,
  }),
  "ingestion.runs": () => ({
    status: "running", started_at: new Date().toISOString(), finished_at: null, sources_attempted: 0, sources_succeeded: 0,
    observations_found: 0, candidates_created: 0, candidates_published: 0, candidates_review: 0, error_summary: null, metadata: {},
  }),
  "ingestion.observations": () => ({ observed_at: new Date().toISOString() }),
  "ingestion.candidates": () => ({
    timezone: "America/New_York", category_slugs: [], vendor_evidence: [], validation_reasons: [], score: 0, is_market: false,
    location_verified: false, vendor_verified: false, cancelled: false, duplicate_state: "unchecked", status: "pending",
    manual_override: false, approved_by: null, published_event_id: null, first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }),
  "ingestion.candidate_sources": () => ({ created_at: new Date().toISOString() }),
  "ingestion.source_discoveries": () => ({ evaluation: "pending", discovered_at: new Date().toISOString(), registered_source_id: null }),
  "ingestion.reviews": () => ({ changes: {}, created_at: new Date().toISOString() }),
  "ingestion.publication_audit": () => ({ details: {}, created_at: new Date().toISOString() }),
};

const UNIQUES: Record<string, string[][]> = {
  "ingestion.sources": [["base_url"]],
  "ingestion.observations": [["source_id", "source_url", "content_hash"]],
  "ingestion.candidates": [["canonical_key"], ["published_event_id"]],
  "ingestion.candidate_sources": [["candidate_id", "observation_id"]],
  "ingestion.source_discoveries": [["discovered_url"]],
  "public.event_ingestion_links": [["event_id"], ["candidate_id"]],
};

function matches(row: Row, cols: string[], other: Row): boolean {
  return cols.every((c) => row[c] !== null && row[c] !== undefined && row[c] === other[c]);
}

/** Mirrors uq_runs_one_running_per_type plus uq_runs_one_running_pipeline (collection, verification and replay share one lock). */
const PIPELINE_TYPES = ["collection", "verification", "replay"];
function runLockClash(existing: Row, candidate: Row): boolean {
  if (existing.status !== "running" || candidate.status !== "running") return false;
  if (existing.run_type === candidate.run_type) return true;
  return PIPELINE_TYPES.includes(existing.run_type as string) && PIPELINE_TYPES.includes(candidate.run_type as string);
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}

/** Minimal in-memory stand-in for the PostgREST calls used by the ingestion storage layer. */
export class MemoryDb {
  readonly tables = new Map<string, Row[]>();
  readonly rpcHandlers = new Map<string, (args: Row) => { data?: unknown; error?: MemoryError | null }>();
  readonly rpcCalls: { name: string; args: Row }[] = [];
  failNext: { key: string; op: string; error: MemoryError }[] = [];
  /** Like PostgREST's `max_rows`: a single select never returns more rows than this, whatever limit/range was requested. */
  maxRows: number | null = null;
  /** Length of every `in (...)` list sent, so tests can assert filters stay within URL limits. */
  readonly inSizes: number[] = [];

  rows(key: string): Row[] {
    if (!this.tables.has(key)) this.tables.set(key, []);
    return this.tables.get(key) as Row[];
  }

  seed(key: string, rows: Row[]): Row[] {
    const out = rows.map((r) => ({ id: randomUUID(), ...(DEFAULTS[key]?.() ?? {}), ...r }));
    this.rows(key).push(...out);
    return out;
  }

  client() {
    const makeFrom = (schema: string) => (table: string) => new Builder(this, `${schema}.${table}`);
    const makeRpc = (schema: string) => (name: string, args: Row = {}) => {
      this.rpcCalls.push({ name: `${schema}.${name}`, args });
      const handler = this.rpcHandlers.get(`${schema}.${name}`);
      const result = handler ? handler(args) : { data: null, error: { code: "42883", message: "function not mocked" } };
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    };
    return {
      schema: (schema: string) => ({ from: makeFrom(schema), rpc: makeRpc(schema) }),
      from: makeFrom("public"),
      rpc: makeRpc("public"),
    };
  }
}

class Builder implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private options: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private offsetN = 0;
  private returning = false;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(private readonly db: MemoryDb, private readonly key: string) {}

  select(columns?: string) { void columns; this.returning = true; return this; }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  upsert(p: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = p; this.options = o; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, v: unknown[]) { this.db.inSizes.push(v.length); this.filters.push((r) => v.includes(r[c])); return this; }
  gte(c: string, v: unknown) { this.filters.push((r) => compare(r[c], v) >= 0); return this; }
  gt(c: string, v: unknown) { this.filters.push((r) => compare(r[c], v) > 0); return this; }
  lte(c: string, v: unknown) { this.filters.push((r) => compare(r[c], v) <= 0); return this; }
  lt(c: string, v: unknown) { this.filters.push((r) => compare(r[c], v) < 0); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this; }
  not(c: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.filters.push((r) => r[c] !== null && r[c] !== undefined);
    else this.filters.push((r) => r[c] !== v);
    return this;
  }
  or(expr: string) {
    const m = /^updated_at\.lt\.(.+?),and\(updated_at\.eq\.(.+?),id\.lt\.(.+?)\)$/.exec(expr);
    if (!m) throw new Error(`Unsupported or() expression: ${expr}`);
    const [, t1, t2, id] = m;
    this.filters.push((r) => compare(r.updated_at, t1) < 0 || (compare(r.updated_at, t2) === 0 && compare(r.id, id) < 0));
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.offsetN = from; this.limitN = to - from + 1; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }

  private fail(code: string, message: string): Result { return { data: null, error: { code, message } }; }

  private finish(rows: Row[]): Result {
    if (!this.returning) return { data: null, error: null };
    const copy = rows.map((r) => structuredClone(r));
    if (this.mode === "single") return copy.length === 1 ? { data: copy[0], error: null } : this.fail("PGRST116", "JSON object requested, multiple (or no) rows returned");
    if (this.mode === "maybe") return copy.length <= 1 ? { data: copy[0] ?? null, error: null } : this.fail("PGRST116", "multiple rows returned");
    return { data: copy, error: null };
  }

  private violates(candidate: Row, ignore?: Row): boolean {
    const uniques = UNIQUES[this.key] ?? [];
    return this.db.rows(this.key).some((r) => r !== ignore && (uniques.some((cols) => matches(r, cols, candidate)) || (this.key === "ingestion.runs" && runLockClash(r, candidate))));
  }

  private insertRow(input: Row): Row {
    const row: Row = { id: randomUUID(), ...(DEFAULTS[this.key]?.() ?? {}), ...structuredClone(input) };
    this.db.rows(this.key).push(row);
    return row;
  }

  private execute(): Result {
    const injected = this.db.failNext.findIndex((f) => f.key === this.key && f.op === this.op);
    if (injected >= 0) {
      const [f] = this.db.failNext.splice(injected, 1);
      return { data: null, error: f.error };
    }
    const table = this.db.rows(this.key);
    if (this.op === "insert" || this.op === "upsert") {
      const inputs = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const out: Row[] = [];
      for (const input of inputs) {
        if (this.op === "upsert") {
          const cols = (this.options.onConflict ?? "id").split(",").map((c) => c.trim());
          const existing = table.find((r) => matches(r, cols, input));
          if (existing) {
            if (!this.options.ignoreDuplicates) { Object.assign(existing, structuredClone(input)); out.push(existing); }
            continue;
          }
        }
        if (this.violates(input)) return this.fail("23505", `duplicate key value violates unique constraint on ${this.key}`);
        out.push(this.insertRow(input));
      }
      return this.finish(out);
    }
    const selected = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const row of selected) {
        const next = { ...row, ...structuredClone(this.payload as Row) };
        if (this.violates(next, row)) return this.fail("23505", "duplicate key value violates unique constraint");
        Object.assign(row, next);
      }
      return this.finish(selected);
    }
    if (this.op === "delete") {
      this.db.tables.set(this.key, table.filter((r) => !selected.includes(r)));
      return this.finish(selected);
    }
    const sorted = [...selected];
    for (const { col, asc } of [...this.orders].reverse()) sorted.sort((a, b) => (asc ? 1 : -1) * compare(a[col], b[col]));
    const windowed = this.limitN === null ? sorted.slice(this.offsetN) : sorted.slice(this.offsetN, this.offsetN + this.limitN);
    const limited = this.db.maxRows === null ? windowed : windowed.slice(0, this.db.maxRows);
    this.returning = true;
    return this.finish(limited);
  }
}
