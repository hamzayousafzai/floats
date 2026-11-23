"use client";

import { useState } from "react";
import { AdminApiError, adminFetch, errorMessage } from "./api";
import { formatDateTime, safeHref } from "./format";
import { ErrorState, LoadingState, StatusBadge } from "./states";
import { useAdminResource } from "./use-admin-resource";

export interface CandidateDetail {
  id: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  organizer_name: string | null;
  venue_name: string | null;
  category_slugs: string[] | null;
  vendor_count: number | null;
  vendor_evidence: unknown;
  score: number | null;
  status: string;
  source_url: string;
  validation_reasons: string[] | null;
  duplicate_state: string | null;
  published_event_id: string | null;
  sources: { source_url: string; match_reason: string }[];
}

type ReviewAction = "approve" | "reject" | "request_review";
type Pending = ReviewAction | "publish" | null;

const ACTIONS: { action: ReviewAction; label: string; from: string[] }[] = [
  { action: "approve", label: "Approve", from: ["needs_review"] },
  { action: "reject", label: "Reject", from: ["needs_review"] },
  { action: "request_review", label: "Request review", from: ["ready", "needs_review"] },
];

function EvidenceLink({ url }: { url: string }) {
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline">
      {url}
    </a>
  ) : (
    <span className="break-all">{url} (not a web link)</span>
  );
}

function ReviewPanel({ detail, onChanged }: { detail: CandidateDetail; onChanged: (message: string, kind: "notice" | "error") => void }) {
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? "");
  const [startsAt, setStartsAt] = useState(detail.starts_at ?? "");
  const [endsAt, setEndsAt] = useState(detail.ends_at ?? "");
  const [address, setAddress] = useState(detail.address ?? "");
  const [organizer, setOrganizer] = useState(detail.organizer_name ?? "");
  const [venue, setVenue] = useState(detail.venue_name ?? "");
  const [latitude, setLatitude] = useState(detail.latitude === null ? "" : String(detail.latitude));
  const [longitude, setLongitude] = useState(detail.longitude === null ? "" : String(detail.longitude));
  const [categories, setCategories] = useState((detail.category_slugs ?? []).join(", "));
  const [vendorCount, setVendorCount] = useState(detail.vendor_count === null ? "" : String(detail.vendor_count));
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const readOnly = detail.status === "published" || detail.status === "rejected";

  function buildChanges(): { changes: Record<string, unknown> } | { error: string } {
    const changes: Record<string, unknown> = {};
    if (title !== detail.title) changes.title = title;
    if (description !== (detail.description ?? "")) changes.description = description;
    if (startsAt !== (detail.starts_at ?? "")) changes.starts_at = startsAt;
    if (endsAt !== (detail.ends_at ?? "")) changes.ends_at = endsAt === "" ? null : endsAt;
    if (address !== (detail.address ?? "")) changes.address = address;
    if (organizer !== (detail.organizer_name ?? "")) changes.organizer_name = organizer;
    if (venue !== (detail.venue_name ?? "")) changes.venue_name = venue;
    const initialCategories = (detail.category_slugs ?? []).join(", ");
    if (categories !== initialCategories) changes.category_slugs = categories.split(",").map((s) => s.trim()).filter(Boolean);
    if (vendorCount !== (detail.vendor_count === null ? "" : String(detail.vendor_count))) {
      if (vendorCount.trim() === "") changes.vendor_count = null;
      else if (!/^\d+$/.test(vendorCount.trim())) return { error: "Vendor count must be a whole number." };
      else changes.vendor_count = Number(vendorCount.trim());
    }
    const latChanged = latitude !== (detail.latitude === null ? "" : String(detail.latitude));
    const lngChanged = longitude !== (detail.longitude === null ? "" : String(detail.longitude));
    if (latChanged || lngChanged) {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (latitude.trim() === "" || longitude.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "Latitude and longitude must both be valid numbers." };
      changes.latitude = lat;
      changes.longitude = lng;
    }
    return { changes };
  }

  async function run(action: ReviewAction) {
    setError("");
    const built = buildChanges();
    if ("error" in built) {
      setError(built.error);
      setPending(null);
      return;
    }
    const { changes } = built;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/ingestion/candidates/${detail.id}`, {
        method: "PATCH",
        body: { action, reason: reason.trim(), ...(Object.keys(changes).length > 0 ? { changes } : {}) },
      });
      setPending(null);
      onChanged(action === "approve" ? "Approved. Approval does not publish; publish separately." : action === "reject" ? "Rejected." : "Review requested.", "notice");
    } catch (e) {
      setPending(null);
      if (e instanceof AdminApiError && e.status === 409) onChanged(e.message, "error");
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setError("");
    setBusy(true);
    try {
      await adminFetch(`/api/admin/ingestion/candidates/${detail.id}/publish`, { method: "POST", body: { manual: true } });
      setPending(null);
      onChanged("Published.", "notice");
    } catch (e) {
      setError(errorMessage(e));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded border px-2 py-1 text-sm";
  const reasonMissing = reason.trim().length === 0;

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={detail.status} />
          <span className="text-sm text-gray-600">Score: {detail.score ?? "—"}</span>
          {detail.duplicate_state && detail.duplicate_state !== "none" ? <span className="text-sm text-amber-700">Duplicate: {detail.duplicate_state}</span> : null}
        </div>
        <div>
          <h3 className="text-sm font-medium">Validation reasons</h3>
          {detail.validation_reasons?.length ? (
            <ul className="list-inside list-disc text-sm">
              {detail.validation_reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">None</p>
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium">Evidence</h3>
          <ul className="space-y-1 text-sm">
            <li>
              Primary: <EvidenceLink url={detail.source_url} />
            </li>
            {detail.sources.map((s) => (
              <li key={`${s.source_url}|${s.match_reason}`}>
                <EvidenceLink url={s.source_url} /> <span className="text-xs text-gray-500">({s.match_reason})</span>
              </li>
            ))}
          </ul>
          {detail.vendor_evidence ? <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(detail.vendor_evidence, null, 2)}</pre> : null}
        </div>
        {detail.published_event_id ? <p className="text-sm">Published event: {detail.published_event_id}</p> : null}
      </section>

      <form className="space-y-3 rounded-lg border p-4" onSubmit={(e) => e.preventDefault()}>
        <h3 className="font-medium">Details {readOnly ? "(read only)" : ""}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            Title
            <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
          </label>
          <label className="block text-sm sm:col-span-2">
            Description
            <textarea className={field} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} />
          </label>
          <label className="block text-sm">
            Starts (ISO 8601 with offset)
            <input className={field} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={readOnly} />
            <span className="text-xs text-gray-500">{formatDateTime(detail.starts_at)} Eastern</span>
          </label>
          <label className="block text-sm">
            Ends (blank if unknown)
            <input className={field} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={readOnly} />
          </label>
          <label className="block text-sm sm:col-span-2">
            Address
            <input className={field} value={address} onChange={(e) => setAddress(e.target.value)} disabled={readOnly} />
          </label>
          <label className="block text-sm">
            Latitude
            <input className={field} value={latitude} onChange={(e) => setLatitude(e.target.value)} disabled={readOnly} inputMode="decimal" />
          </label>
          <label className="block text-sm">
            Longitude
            <input className={field} value={longitude} onChange={(e) => setLongitude(e.target.value)} disabled={readOnly} inputMode="decimal" />
          </label>
          <label className="block text-sm">
            Organizer
            <input className={field} value={organizer} onChange={(e) => setOrganizer(e.target.value)} disabled={readOnly} />
          </label>
          <label className="block text-sm">
            Venue
            <input className={field} value={venue} onChange={(e) => setVenue(e.target.value)} disabled={readOnly} />
          </label>
          <label className="block text-sm">
            Categories (comma separated)
            <input className={field} value={categories} onChange={(e) => setCategories(e.target.value)} disabled={readOnly} />
          </label>
          <label className="block text-sm">
            Vendor count
            <input className={field} value={vendorCount} onChange={(e) => setVendorCount(e.target.value)} disabled={readOnly} inputMode="numeric" />
          </label>
        </div>

        {!readOnly ? (
          <>
            <label className="block text-sm">
              Reason for decision (required)
              <textarea className={field} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </label>
            <div className="flex flex-wrap gap-2">
              {ACTIONS.map(({ action, label, from }) => (
                <button
                  key={action}
                  type="button"
                  disabled={busy || reasonMissing || !from.includes(detail.status)}
                  onClick={() => setPending(action)}
                  className="rounded bg-gray-100 px-4 py-2 text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
            {pending && pending !== "publish" ? (
              <div role="alertdialog" aria-label="Confirm decision" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                <p>Confirm: {pending.replace("_", " ")} this candidate? This is recorded in the review log.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => run(pending)} className="rounded bg-black px-3 py-1 font-medium text-white disabled:opacity-50">
                    Confirm {pending.replace("_", " ")}
                  </button>
                  <button type="button" onClick={() => setPending(null)} className="rounded bg-white px-3 py-1 ring-1 ring-gray-300">
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </form>

      {detail.status === "approved" ? (
        <section className="space-y-2 rounded-lg border p-4">
          <h3 className="font-medium">Publication</h3>
          <p className="text-sm text-gray-600">Approval does not publish. Publishing creates a public event if all publication gates pass, even while automatic publishing is in shadow mode.</p>
          <button type="button" disabled={busy} onClick={() => setPending("publish")} className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Publish manually
          </button>
          {pending === "publish" ? (
            <div role="alertdialog" aria-label="Confirm publication" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <p>Confirm: publish this event to the public map?</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={publish} className="rounded bg-black px-3 py-1 font-medium text-white disabled:opacity-50">
                  Confirm publish
                </button>
                <button type="button" onClick={() => setPending(null)} className="rounded bg-white px-3 py-1 ring-1 ring-gray-300">
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}

export function CandidateReviewForm({ candidateId }: { candidateId: string }) {
  const { state, reload } = useAdminResource<{ data: CandidateDetail }>(`/api/admin/ingestion/candidates/${candidateId}`);
  const [flash, setFlash] = useState<{ message: string; kind: "notice" | "error" } | null>(null);
  const banner = flash ? (
    flash.kind === "error" ? (
      <ErrorState message={flash.message} />
    ) : (
      <p role="status" className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
        {flash.message}
      </p>
    )
  ) : null;
  if (state.status === "loading") return <LoadingState label={flash ? "Refreshing…" : "Loading candidate…"} />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;
  return (
    <div className="space-y-4">
      {banner}
      <ReviewPanel
        detail={state.data.data}
        onChanged={(message, kind) => {
          setFlash({ message, kind });
          reload();
        }}
      />
    </div>
  );
}
