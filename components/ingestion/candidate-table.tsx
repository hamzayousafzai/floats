"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminFetch, errorMessage } from "./api";
import { formatDateTime, safeHref } from "./format";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "./states";

export interface CandidateListItem {
  id: string;
  title: string;
  starts_at: string | null;
  address: string | null;
  organizer_name: string | null;
  source_url: string;
  score: number | null;
  status: string;
  validation_reasons: string[] | null;
  duplicate_state: string | null;
  published_event_id: string | null;
}
interface ListResponse {
  data: CandidateListItem[];
  next_cursor: string | null;
}

const STATUSES = ["needs_review", "ready", "approved", "published", "rejected", "pending"] as const;
const PAGE_SIZE = 25;

export function CandidateTable() {
  const [status, setStatus] = useState<string>("needs_review");
  const [rows, setRows] = useState<CandidateListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPhase("loading");
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (status) query.set("status", status);
    adminFetch<ListResponse>(`/api/admin/ingestion/candidates?${query}`, { signal: controller.signal }).then(
      (body) => {
        setRows(body.data);
        setCursor(body.next_cursor);
        setPhase("ready");
      },
      (e: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(e));
        setPhase("error");
      },
    );
    return () => controller.abort();
  }, [status, nonce]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), cursor });
    if (status) query.set("status", status);
    try {
      const body = await adminFetch<ListResponse>(`/api/admin/ingestion/candidates?${query}`);
      setRows((prev) => [...prev, ...body.data]);
      setCursor(body.next_cursor);
    } catch (e) {
      setError(errorMessage(e));
      setPhase("error");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, status]);

  return (
    <section className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border px-2 py-1">
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>

      {phase === "loading" ? <LoadingState label="Loading candidates…" /> : null}
      {phase === "error" ? <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} /> : null}
      {phase === "ready" && rows.length === 0 ? <EmptyState message="No candidates found." /> : null}
      {phase === "ready" && rows.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="p-2">Title</th>
                  <th className="p-2">Starts</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Score</th>
                  <th className="p-2">Reasons</th>
                  <th className="p-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const href = safeHref(row.source_url);
                  return (
                    <tr key={row.id} className="border-t align-top">
                      <td className="p-2">
                        <Link href={`/admin/ingestion/candidates/${row.id}`} className="font-medium underline">
                          {row.title}
                        </Link>
                        {row.organizer_name ? <div className="text-xs text-gray-500">{row.organizer_name}</div> : null}
                      </td>
                      <td className="p-2 whitespace-nowrap">{formatDateTime(row.starts_at)}</td>
                      <td className="p-2">
                        <StatusBadge value={row.status} />
                        {row.duplicate_state && row.duplicate_state !== "none" ? <div className="mt-1 text-xs text-amber-700">duplicate: {row.duplicate_state}</div> : null}
                      </td>
                      <td className="p-2">{row.score ?? "—"}</td>
                      <td className="p-2 text-xs">{row.validation_reasons?.length ? row.validation_reasons.join(", ") : "—"}</td>
                      <td className="p-2 text-xs break-all">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                            {new URL(href).hostname}
                          </a>
                        ) : (
                          <span>{row.source_url}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {cursor ? (
            <button type="button" disabled={loadingMore} onClick={loadMore} className="rounded bg-gray-100 px-4 py-2 text-sm font-medium hover:bg-gray-200 disabled:opacity-50">
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
