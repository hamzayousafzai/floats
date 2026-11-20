"use client";

import { formatDateTime } from "./format";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "./states";
import { useAdminResource } from "./use-admin-resource";

export interface RunItem {
  id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  sources_attempted: number;
  sources_succeeded: number;
  observations_found: number;
  candidates_created: number;
  candidates_published: number;
  candidates_review: number;
  error_summary: string | null;
}

export function RunTable({ limit = 25 }: { limit?: number }) {
  const { state, reload } = useAdminResource<{ data: RunItem[] }>(`/api/admin/ingestion/runs?limit=${limit}`);
  if (state.status === "loading") return <LoadingState label="Loading runs…" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const runs = state.data.data;
  if (runs.length === 0) return <EmptyState message="No runs recorded yet." />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="p-2">Started</th>
            <th className="p-2">Type</th>
            <th className="p-2">Status</th>
            <th className="p-2">Sources ok / tried</th>
            <th className="p-2">Observations</th>
            <th className="p-2">Created / review / published</th>
            <th className="p-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-t align-top">
              <td className="p-2 whitespace-nowrap">{formatDateTime(run.started_at)}</td>
              <td className="p-2">{run.run_type}</td>
              <td className="p-2">
                <StatusBadge value={run.status} />
              </td>
              <td className="p-2">
                {run.sources_succeeded} / {run.sources_attempted}
              </td>
              <td className="p-2">{run.observations_found}</td>
              <td className="p-2">
                {run.candidates_created} / {run.candidates_review} / {run.candidates_published}
              </td>
              <td className="max-w-xs break-words p-2 text-xs text-red-700">{run.error_summary ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
