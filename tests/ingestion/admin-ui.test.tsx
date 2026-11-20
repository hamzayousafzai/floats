import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CandidateReviewForm } from "@/components/ingestion/candidate-review-form";
import { CandidateTable } from "@/components/ingestion/candidate-table";
import { IngestionSummary } from "@/components/ingestion/ingestion-summary";
import { RunTable } from "@/components/ingestion/run-table";
import { SourceTable } from "@/components/ingestion/source-table";
import { adminFetch } from "@/components/ingestion/api";
import { safeHref } from "@/components/ingestion/format";

const ID = "11111111-1111-4111-8111-111111111111";

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;
let handlers: Handler[] = [];
const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

beforeEach(() => {
  handlers = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    for (const handler of handlers) {
      const out = handler(url, init);
      if (out) return respond(out.status ?? 200, out.body);
    }
    return respond(500, { ok: false, error: { code: "INTERNAL_ERROR", message: "unhandled" } });
  });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit | undefined }));
const on = (match: (url: string, init?: RequestInit) => boolean, body: unknown, status = 200) => handlers.push((url, init) => (match(url, init) ? { status, body } : undefined));

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: "Riverside Makers Market",
    description: "Local makers",
    starts_at: "2026-12-05T15:00:00.000Z",
    ends_at: null,
    timezone: "America/New_York",
    address: "1 Main St, Albany, NY",
    latitude: 42.65,
    longitude: -73.75,
    organizer_name: "Riverside Collective",
    venue_name: null,
    category_slugs: ["makers"],
    vendor_count: 12,
    vendor_evidence: null,
    score: 82,
    status: "needs_review",
    source_url: "https://example.org/market",
    validation_reasons: ["missing_end_time"],
    duplicate_state: "none",
    published_event_id: null,
    sources: [],
    ...over,
  };
}

describe("safeHref", () => {
  it("allows only http and https", () => {
    expect(safeHref("https://example.org/a")).toBe("https://example.org/a");
    expect(safeHref("http://example.org/")).toBe("http://example.org/");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "/relative", "", null, undefined, "vbscript:x"]) expect(safeHref(bad as string)).toBeNull();
  });
});

describe("adminFetch", () => {
  it("only calls the ingestion admin API", async () => {
    await expect(adminFetch("https://evil.example/x")).rejects.toThrow();
    await expect(adminFetch("/api/other")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("maps API errors and network failures", async () => {
    on((u) => u.endsWith("/a"), { ok: false, error: { code: "CONFLICT", message: "Stale" } }, 409);
    await expect(adminFetch("/api/admin/ingestion/a")).rejects.toMatchObject({ code: "CONFLICT", message: "Stale", status: 409 });
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("down")));
    await expect(adminFetch("/api/admin/ingestion/b")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("CandidateTable", () => {
  it("shows loading, then rows with safe source links", async () => {
    on((u) => u.includes("/candidates?"), {
      ok: true,
      next_cursor: null,
      data: [
        { ...candidate(), id: ID },
        { ...candidate({ id: "22222222-2222-4222-8222-222222222222", title: "Sneaky Market", source_url: "javascript:alert(1)" }) },
      ],
    });
    render(<CandidateTable />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(await screen.findByText("Riverside Makers Market")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "example.org" })).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByRole("link", { name: "Riverside Makers Market" })).toHaveAttribute("href", `/admin/ingestion/candidates/${ID}`);
    expect(screen.getByText("javascript:alert(1)").closest("a")).toBeNull();
    expect(screen.getAllByText("missing_end_time", { exact: false }).length).toBeGreaterThan(0);
  });

  it("requests needs_review first and refetches when the filter changes", async () => {
    on((u) => u.includes("/candidates?"), { ok: true, next_cursor: null, data: [] });
    render(<CandidateTable />);
    expect(await screen.findByText("No candidates found.")).toBeInTheDocument();
    expect(calls()[0].url).toContain("status=needs_review");
    await userEvent.selectOptions(screen.getByLabelText("Status"), "approved");
    await waitFor(() => expect(calls().some((c) => c.url.includes("status=approved"))).toBe(true));
  });

  it("shows an error with retry", async () => {
    render(<CandidateTable />);
    expect(await screen.findByRole("alert")).toHaveTextContent("unhandled");
    on((u) => u.includes("/candidates?"), { ok: true, next_cursor: null, data: [candidate()] });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Riverside Makers Market")).toBeInTheDocument();
  });

  it("loads the next page with the cursor", async () => {
    handlers.push((url) => {
      if (url.includes("cursor=abc")) return { body: { ok: true, next_cursor: null, data: [candidate({ id: "33333333-3333-4333-8333-333333333333", title: "Second Page Market" })] } };
      if (url.includes("/candidates?")) return { body: { ok: true, next_cursor: "abc", data: [candidate()] } };
    });
    render(<CandidateTable />);
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Second Page Market")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("only ever calls the admin ingestion API", async () => {
    on((u) => u.includes("/candidates?"), { ok: true, next_cursor: null, data: [candidate()] });
    render(<CandidateTable />);
    await screen.findByText("Riverside Makers Market");
    for (const c of calls()) expect(c.url.startsWith("/api/admin/ingestion/")).toBe(true);
  });
});

describe("CandidateReviewForm", () => {
  const detailUrl = `/api/admin/ingestion/candidates/${ID}`;
  const serve = (detail: Record<string, unknown> = {}) => on((u, i) => u === detailUrl && (!i || i.method === "GET"), { ok: true, data: candidate(detail) });

  it("shows loading, then details, evidence and reasons; unsafe evidence is not a link", async () => {
    serve({ sources: [{ source_url: "javascript:alert(1)", match_reason: "same_title" }, { source_url: "https://other.example/e", match_reason: "same_address" }] });
    render(<CandidateReviewForm candidateId={ID} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Riverside Makers Market")).toBeInTheDocument();
    expect(screen.getByText("missing_end_time")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://other.example/e" })).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/javascript:alert\(1\)/).closest("a")).toBeNull();
  });

  it("shows an error state when the candidate cannot load", async () => {
    on((u) => u === detailUrl, { ok: false, error: { code: "NOT_FOUND", message: "Candidate not found" } }, 404);
    render(<CandidateReviewForm candidateId={ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Candidate not found");
  });

  it("requires a reason, confirms, and sends only changed fields with the action", async () => {
    serve();
    on((u, i) => u === detailUrl && i?.method === "PATCH", { ok: true, candidate_id: ID, status: "approved", published_event_id: null });
    render(<CandidateReviewForm candidateId={ID} />);
    const title = await screen.findByLabelText("Title");
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    await userEvent.clear(title);
    await userEvent.type(title, "Riverside Makers Holiday Market");
    await userEvent.type(screen.getByLabelText(/Reason for decision/), "Verified on organizer page");
    await userEvent.click(approve);
    expect(calls().some((c) => c.init?.method === "PATCH")).toBe(false);
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /Confirm approve/ }));
    await waitFor(() => expect(calls().some((c) => c.init?.method === "PATCH")).toBe(true));
    const sent = JSON.parse(String(calls().find((c) => c.init?.method === "PATCH")?.init?.body));
    expect(sent).toEqual({ action: "approve", reason: "Verified on organizer page", changes: { title: "Riverside Makers Holiday Market" } });
    expect(await screen.findByText(/Approval does not publish/)).toBeInTheDocument();
    expect(calls().some((c) => c.url.endsWith("/publish"))).toBe(false);
  });

  it("surfaces a hard-gate conflict from the server", async () => {
    serve();
    on((u, i) => u === detailUrl && i?.method === "PATCH", { ok: false, error: { code: "CONFLICT", message: "Hard gates are unresolved" } }, 409);
    render(<CandidateReviewForm candidateId={ID} />);
    await userEvent.type(await screen.findByLabelText(/Reason for decision/), "ok");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: /Confirm approve/ }));
    expect(await screen.findByText("Hard gates are unresolved")).toBeInTheDocument();
  });

  it("rejects invalid coordinates and vendor counts locally", async () => {
    serve();
    render(<CandidateReviewForm candidateId={ID} />);
    await userEvent.type(await screen.findByLabelText(/Reason for decision/), "ok");
    await userEvent.clear(screen.getByLabelText("Latitude"));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: /Confirm approve/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Latitude and longitude/);
    expect(calls().some((c) => c.init?.method === "PATCH")).toBe(false);
  });

  it("only offers decisions valid for the status and no publish for non-approved candidates", async () => {
    serve({ status: "ready" });
    render(<CandidateReviewForm candidateId={ID} />);
    await userEvent.type(await screen.findByLabelText(/Reason for decision/), "ok");
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Request review" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Publish manually" })).toBeNull();
  });

  it("publishes only through a separate confirmed action on approved candidates", async () => {
    serve({ status: "approved" });
    on((u, i) => u === `${detailUrl}/publish` && i?.method === "POST", { ok: true, candidate_id: ID, event_id: "e1", status: "published" });
    render(<CandidateReviewForm candidateId={ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Publish manually" }));
    expect(calls().some((c) => c.url.endsWith("/publish"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Confirm publish" }));
    await waitFor(() => expect(calls().some((c) => c.url.endsWith("/publish"))).toBe(true));
    expect(JSON.parse(String(calls().find((c) => c.url.endsWith("/publish"))?.init?.body))).toEqual({ manual: true });
    expect(await screen.findByText("Published.")).toBeInTheDocument();
  });

  it("is read only once published or rejected", async () => {
    serve({ status: "published", published_event_id: "evt-1" });
    render(<CandidateReviewForm candidateId={ID} />);
    expect(await screen.findByLabelText("Title")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText(/Published event: evt-1/)).toBeInTheDocument();
  });
});

describe("SourceTable", () => {
  const source = (over: Record<string, unknown> = {}) => ({ id: "s1", name: "Example Organizer", base_url: "https://example.org", source_type: "organizer", adapter: "html", trust_state: "probation", enabled: true, valid_events: 4, rejected_events: 1, successful_runs: 3, failed_runs: 0, last_success_at: null, ...over });

  it("shows an empty state", async () => {
    on((u) => u.endsWith("/sources"), { ok: true, data: [] });
    render(<SourceTable />);
    expect(await screen.findByText("No sources registered.")).toBeInTheDocument();
  });

  it("promotes only after confirmation and shows server blockers", async () => {
    on((u, i) => u.endsWith("/sources") && (!i || i.method === "GET"), { ok: true, data: [source()] });
    on((u, i) => u.endsWith("/sources/s1") && i?.method === "PATCH", { ok: false, error: { code: "CONFLICT", message: "Trust promotion requirements not met: insufficient_approved_candidates" } }, 409);
    render(<SourceTable />);
    await userEvent.click(await screen.findByRole("button", { name: "Promote to trusted" }));
    expect(calls().some((c) => c.init?.method === "PATCH")).toBe(false);
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("insufficient_approved_candidates");
    expect(JSON.parse(String(calls().find((c) => c.init?.method === "PATCH")?.init?.body))).toEqual({ trust_state: "trusted" });
  });

  it("offers demotion for trusted sources and no promotion", async () => {
    on((u) => u.endsWith("/sources"), { ok: true, data: [source({ trust_state: "trusted" })] });
    render(<SourceTable />);
    expect(await screen.findByRole("button", { name: "Demote to probation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Promote to trusted" })).toBeNull();
  });

  it("offers no enable control for a disabled-trust source", async () => {
    on((u) => u.endsWith("/sources"), { ok: true, data: [source({ trust_state: "disabled", enabled: false })] });
    render(<SourceTable />);
    expect(await screen.findByRole("button", { name: "Return to probation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable source" })).toBeNull();
  });
});

describe("RunTable and IngestionSummary", () => {
  const run = (over: Record<string, unknown> = {}) => ({ id: "r1", run_type: "collection", status: "failed", started_at: "2026-12-01T09:00:00.000Z", finished_at: null, sources_attempted: 3, sources_succeeded: 1, observations_found: 5, candidates_created: 2, candidates_published: 0, candidates_review: 2, error_summary: "adapter timeout", ...over });

  it("renders runs as text and handles empty and error states", async () => {
    on((u) => u.includes("/runs"), { ok: true, data: [run({ error_summary: "<img src=x onerror=alert(1)>" })] });
    const { container, unmount } = render(<RunTable />);
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    unmount();
    handlers = [];
    on((u) => u.includes("/runs"), { ok: true, data: [] });
    render(<RunTable />);
    expect(await screen.findByText("No runs recorded yet.")).toBeInTheDocument();
  });

  it("shows an error when runs cannot load", async () => {
    render(<RunTable />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("summarizes last run, review queue and source health", async () => {
    on((u) => u.includes("/runs"), { ok: true, data: [run()] });
    on((u) => u.endsWith("/sources"), { ok: true, data: [{ id: "a", name: "A", trust_state: "trusted", enabled: true, successful_runs: 5, failed_runs: 0 }, { id: "b", name: "B", trust_state: "probation", enabled: true, successful_runs: 0, failed_runs: 2 }] });
    on((u) => u.includes("/candidates?"), { ok: true, next_cursor: null, data: [candidate(), candidate()] });
    render(<IngestionSummary />);
    expect(await screen.findByText("1 of 3 sources succeeded")).toBeInTheDocument();
    expect(screen.getByText("adapter timeout")).toBeInTheDocument();
    expect(screen.getByLabelText("Needs review")).toHaveTextContent("2");
    expect(screen.getByLabelText("Source health")).toHaveTextContent("2 total · 1 trusted · 1 probation · 0 disabled");
    expect(screen.getByLabelText("Source health")).toHaveTextContent("1 failing more than succeeding");
  });
});
