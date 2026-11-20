export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="rounded-lg border p-4 text-sm text-gray-500">
      {label}
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-2 rounded bg-white px-3 py-1 font-medium ring-1 ring-red-300 hover:bg-red-100">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">{message}</p>;
}

export function StatusBadge({ value }: { value: string }) {
  const tone =
    value === "published" || value === "approved" || value === "trusted" || value === "succeeded"
      ? "bg-green-100 text-green-800"
      : value === "rejected" || value === "failed" || value === "disabled"
        ? "bg-red-100 text-red-800"
        : value === "needs_review" || value === "probation" || value === "partial"
          ? "bg-amber-100 text-amber-800"
          : "bg-gray-100 text-gray-700";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{value.replace(/_/g, " ")}</span>;
}
