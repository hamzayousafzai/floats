"use client";

import { useState } from "react";
import { adminFetch, errorMessage } from "./api";
import { formatDateTime } from "./format";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "./states";
import { useAdminResource } from "./use-admin-resource";

export interface SourceItem {
  id: string;
  name: string;
  base_url: string;
  source_type: string;
  adapter: string;
  trust_state: "probation" | "trusted" | "disabled";
  enabled: boolean;
  valid_events: number;
  rejected_events: number;
  successful_runs: number;
  failed_runs: number;
  last_success_at: string | null;
  discovery_only?: boolean;
}

interface Change {
  id: string;
  label: string;
  body: { trust_state?: SourceItem["trust_state"]; enabled?: boolean };
}

function controlsFor(source: SourceItem): Change[] {
  const out: Change[] = [];
  if (source.trust_state === "probation") out.push({ id: source.id, label: "Promote to trusted", body: { trust_state: "trusted" } });
  if (source.trust_state === "trusted") out.push({ id: source.id, label: "Demote to probation", body: { trust_state: "probation" } });
  if (source.trust_state === "disabled") out.push({ id: source.id, label: "Return to probation", body: { trust_state: "probation" } });
  else if (source.enabled) out.push({ id: source.id, label: "Disable source", body: { enabled: false } });
  else out.push({ id: source.id, label: "Enable source", body: { enabled: true } });
  return out;
}

export function SourceTable() {
  const { state, reload } = useAdminResource<{ data: SourceItem[] }>("/api/admin/ingestion/sources");
  const [confirming, setConfirming] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ sourceId: string; text: string; kind: "error" | "notice" } | null>(null);

  async function apply(change: Change) {
    setBusy(true);
    setMessage(null);
    try {
      await adminFetch(`/api/admin/ingestion/sources/${change.id}`, { method: "PATCH", body: change.body });
      setMessage({ sourceId: change.id, text: `${change.label}: done.`, kind: "notice" });
      reload();
    } catch (e) {
      setMessage({ sourceId: change.id, text: errorMessage(e), kind: "error" });
    } finally {
      setConfirming(null);
      setBusy(false);
    }
  }

  if (state.status === "loading") return <LoadingState label="Loading sources…" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  const sources = state.data.data;
  if (sources.length === 0) return <EmptyState message="No sources registered." />;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="p-2">Source</th>
            <th className="p-2">Trust</th>
            <th className="p-2">Enabled</th>
            <th className="p-2">Valid / rejected</th>
            <th className="p-2">Runs ok / failed</th>
            <th className="p-2">Last success</th>
            <th className="p-2">Controls</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.id} className="border-t align-top">
              <td className="p-2">
                <div className="font-medium">{source.name}</div>
                <div className="text-xs text-gray-500">
                  {source.source_type} · {source.adapter}
                  {source.discovery_only ? " · discovery only" : ""}
                </div>
                <div className="break-all text-xs text-gray-500">{source.base_url}</div>
              </td>
              <td className="p-2">
                <StatusBadge value={source.trust_state} />
              </td>
              <td className="p-2">{source.enabled ? "Yes" : "No"}</td>
              <td className="p-2">
                {source.valid_events} / {source.rejected_events}
              </td>
              <td className="p-2">
                {source.successful_runs} / {source.failed_runs}
              </td>
              <td className="p-2 whitespace-nowrap">{formatDateTime(source.last_success_at)}</td>
              <td className="space-y-2 p-2">
                <div className="flex flex-wrap gap-2">
                  {controlsFor(source).map((change) => (
                    <button key={change.label} type="button" disabled={busy} onClick={() => setConfirming(change)} className="rounded bg-gray-100 px-3 py-1 text-xs font-medium hover:bg-gray-200 disabled:opacity-50">
                      {change.label}
                    </button>
                  ))}
                </div>
                {confirming?.id === source.id ? (
                  <div role="alertdialog" aria-label="Confirm source change" className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">
                    <p>Confirm: {confirming.label.toLowerCase()} for {source.name}? Trust changes are audited.</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={busy} onClick={() => apply(confirming)} className="rounded bg-black px-3 py-1 font-medium text-white disabled:opacity-50">
                        Confirm
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="rounded bg-white px-3 py-1 ring-1 ring-gray-300">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                {message?.sourceId === source.id ? (
                  <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-xs text-red-700" : "text-xs text-green-700"}>
                    {message.text}
                  </p>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
