"use client";

import Link from "next/link";
import { formatDateTime } from "./format";
import { ErrorState, LoadingState, StatusBadge } from "./states";
import { useAdminResource } from "./use-admin-resource";
import type { RunItem } from "./run-table";
import type { SourceItem } from "./source-table";

interface Overview {
  runs: { data: RunItem[] };
  sources: { data: SourceItem[] };
  review: { data: unknown[]; next_cursor: string | null };
}

function useOverviewParts() {
  const runs = useAdminResource<Overview["runs"]>("/api/admin/ingestion/runs?limit=1");
  const sources = useAdminResource<Overview["sources"]>("/api/admin/ingestion/sources");
  const review = useAdminResource<Overview["review"]>("/api/admin/ingestion/candidates?status=needs_review&limit=100");
  return { runs, sources, review };
}

export function IngestionSummary() {
  const { runs, sources, review } = useOverviewParts();
  const parts = [runs, sources, review];
  const failed = parts.find((p) => p.state.status === "error");
  if (failed && failed.state.status === "error") {
    return (
      <ErrorState
        message={failed.state.message}
        onRetry={() => {
          for (const p of parts) p.reload();
        }}
      />
    );
  }
  if (runs.state.status !== "ready" || sources.state.status !== "ready" || review.state.status !== "ready") return <LoadingState label="Loading overview…" />;

  const lastRun = runs.state.data.data[0];
  const sourceList = sources.state.data.data;
  const count = (state: SourceItem["trust_state"]) => sourceList.filter((s) => s.trust_state === state).length;
  const pendingReview = review.state.data.data.length;
  const more = review.state.data.next_cursor ? "+" : "";
  const unhealthy = sourceList.filter((s) => s.enabled && s.failed_runs > s.successful_runs).length;
  const card = "rounded-lg border p-4";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <section className={card} aria-label="Last run">
        <h3 className="text-sm font-medium text-gray-500">Last run</h3>
        {lastRun ? (
          <div className="mt-2 space-y-1 text-sm">
            <StatusBadge value={lastRun.status} />
            <p>{formatDateTime(lastRun.started_at)}</p>
            <p>
              {lastRun.sources_succeeded} of {lastRun.sources_attempted} sources succeeded
            </p>
            {lastRun.error_summary ? <p className="text-xs text-red-700">{lastRun.error_summary}</p> : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">No runs yet.</p>
        )}
        <Link href="/admin/ingestion/runs" className="mt-3 inline-block text-sm underline">
          All runs
        </Link>
      </section>
      <section className={card} aria-label="Needs review">
        <h3 className="text-sm font-medium text-gray-500">Needs review</h3>
        <p className="mt-2 text-3xl font-semibold">
          {pendingReview}
          {more}
        </p>
        <Link href="/admin/ingestion/candidates" className="mt-3 inline-block text-sm underline">
          Review candidates
        </Link>
      </section>
      <section className={card} aria-label="Source health">
        <h3 className="text-sm font-medium text-gray-500">Sources</h3>
        <p className="mt-2 text-sm">
          {sourceList.length} total · {count("trusted")} trusted · {count("probation")} probation · {count("disabled")} disabled
        </p>
        <p className="mt-1 text-sm">{unhealthy} failing more than succeeding</p>
        <Link href="/admin/ingestion/sources" className="mt-3 inline-block text-sm underline">
          Manage sources
        </Link>
      </section>
    </div>
  );
}
