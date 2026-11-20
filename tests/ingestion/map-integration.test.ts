/**
 * @jest-environment node
 */
import { GET } from "@/app/api/map/search/route";

type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: Row[]; error: null | { message: string } }> {
  private filters: ((r: Row) => boolean)[] = [];
  constructor(private rows: Row[], private failWith?: string) {}
  select() { return this; }
  order() { return this; }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
  gte(col: string, v: number | string) { this.filters.push((r) => (r[col] as number | string) >= v); return this; }
  lt(col: string, v: number | string) { this.filters.push((r) => (r[col] as number | string) < v); return this; }
  lte(col: string, v: number | string) { this.filters.push((r) => (r[col] as number | string) <= v); return this; }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[col])); return this; }
  then<T1, T2>(ok?: ((v: { data: Row[]; error: null | { message: string } }) => T1 | PromiseLike<T1>) | null, bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null) {
    const result = this.failWith ? { data: [] as Row[], error: { message: this.failWith } } : { data: this.rows.filter((r) => this.filters.every((f) => f(r))), error: null };
    return Promise.resolve(result).then(ok, bad);
  }
}

const state = {
  events: [] as Row[],
  links: [] as Row[],
  linkError: undefined as string | undefined,
  adminThrows: false,
  adminTables: [] as string[],
  serverTables: [] as string[],
};

jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: () => ({
    from: (table: string) => {
      state.serverTables.push(table);
      return new FakeQuery(table === "events" ? state.events : []);
    },
  }),
}));
jest.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => {
    if (state.adminThrows) throw new Error("Supabase URL or Service Role Key is missing from environment variables.");
    return {
      from: (table: string) => {
        state.adminTables.push(table);
        return new FakeQuery(table === "event_ingestion_links" ? state.links : [], state.linkError);
      },
    };
  },
}));

const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
let seq = 0;
function event(over: Row = {}): Row {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    title: `Event ${seq}`,
    description: "d",
    starts_at: startsAt,
    ends_at: null,
    image_url: null,
    address: "100 Example St",
    latitude: 35.2271,
    longitude: -80.8431,
    geom: null,
    status: "published",
    org: null,
    ...over,
  };
}

async function search(params = "lat=35.2271&lng=-80.8431&distance=10&when=this-month") {
  const res = await GET(new Request(`http://localhost/api/map/search?${params}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>[] };
}

beforeEach(() => {
  state.events = [];
  state.links = [];
  state.linkError = undefined;
  state.adminThrows = false;
  state.adminTables = [];
  state.serverTables = [];
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("map search organizer fallback", () => {
  it("keeps the response contract intact", async () => {
    state.events = [event({ org: [{ name: "Owner Org", slug: "owner-org" }] })];
    const { status, body } = await search();
    expect(status).toBe(200);
    expect(Object.keys(body[0]).sort()).toEqual(["address", "description", "ends_at", "id", "imageUrl", "lat", "lng", "starts_at", "title", "vendorName", "vendorSlug"]);
  });

  it("leaves an organization-owned pin unchanged and does not read provenance for it", async () => {
    const owned = event({ org: [{ name: "Owner Org", slug: "owner-org" }] });
    state.events = [owned];
    state.links = [{ event_id: owned.id, organizer_display_name: "Imported Name" }];
    const { body } = await search();
    expect(body[0]).toMatchObject({ vendorName: "Owner Org", vendorSlug: "owner-org" });
    expect(state.adminTables).toEqual([]);
  });

  it("also reads an organization returned as a single object", async () => {
    state.events = [event({ org: { name: "Object Org", slug: "object-org" } })];
    const { body } = await search();
    expect(body[0]).toMatchObject({ vendorName: "Object Org", vendorSlug: "object-org" });
  });

  it("shows the imported organizer name for an unclaimed event, with an empty slug", async () => {
    const imported = event();
    state.events = [imported];
    state.links = [{ event_id: imported.id, organizer_display_name: "  Example Collective " }];
    const { body } = await search();
    expect(body[0]).toMatchObject({ vendorName: "Example Collective", vendorSlug: "" });
    expect(state.adminTables).toEqual(["event_ingestion_links"]);
  });

  it("falls back to an empty name when provenance has none, blank, or is absent", async () => {
    const a = event();
    const b = event();
    const c = event();
    state.events = [a, b, c];
    state.links = [{ event_id: a.id, organizer_display_name: null }, { event_id: b.id, organizer_display_name: "   " }];
    const { body } = await search();
    expect(body.map((p) => p.vendorName)).toEqual(["", "", ""]);
  });

  it("still returns pins when the provenance lookup fails or the service role is not configured", async () => {
    state.events = [event()];
    state.linkError = "boom";
    expect((await search()).body).toHaveLength(1);
    state.linkError = undefined;
    state.adminThrows = true;
    const { status, body } = await search();
    expect(status).toBe(200);
    expect(body[0].vendorName).toBe("");
  });

  it("hides drafts and rows without usable coordinates, and never queries provenance for them", async () => {
    const draft = event({ status: "draft" });
    const noCoords = event({ latitude: null, longitude: null });
    const visible = event();
    state.events = [draft, noCoords, visible];
    state.links = [{ event_id: draft.id, organizer_display_name: "Draft Org" }];
    const { body } = await search();
    expect(body.map((p) => p.id)).toEqual([visible.id]);
    expect(state.adminTables).toEqual(["event_ingestion_links"]);
  });

  it("applies the existing geographic and date filters", async () => {
    const near = event();
    const far = event({ latitude: 40.7, longitude: -74.0 });
    const past = event({ starts_at: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    state.events = [near, far, past];
    const { body } = await search();
    expect(body.map((p) => p.id)).toEqual([near.id]);
  });

  it("only ever reads provenance through the service-role client, never the request-scoped one", async () => {
    state.events = [event()];
    await search();
    expect(state.serverTables).not.toContain("event_ingestion_links");
  });

  it("still rejects missing coordinates", async () => {
    const res = await GET(new Request("http://localhost/api/map/search?lat=abc"));
    expect(res.status).toBe(400);
  });
});
