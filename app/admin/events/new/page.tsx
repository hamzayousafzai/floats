"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AdminNewEventPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    starts_at: "",
    ends_at: "",
    address: "", // Address is now the only required location field
    image_url: "",
    is_market: false,
    vendor_id: "",
  });

  function update<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // The payload is now just the form state. No need to handle 'coords'.
      const res = await fetch("/admin/events/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || "An unknown error occurred.");
      }
      // On success, navigate to the main admin page
      router.push("/admin/events");
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Create Event</h2>
      <form onSubmit={submit} className="space-y-4 text-sm">
        <div>
          <label className="font-medium">Title</label>
          <input required value={form.title} onChange={(e) => update("title", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <label className="font-medium">Description</label>
          <textarea rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="font-medium">Starts At</label>
            <input required type="datetime-local" value={form.starts_at} onChange={(e) => update("starts_at", e.target.value)} className="mt-1 w-full rounded border p-2" />
          </div>
          <div>
            <label className="font-medium">Ends At (Optional)</label>
            <input type="datetime-local" value={form.ends_at} onChange={(e) => update("ends_at", e.target.value)} className="mt-1 w-full rounded border p-2" />
          </div>
        </div>
        <div>
          <label className="font-medium">Address</label>
          <input required value={form.address} onChange={(e) => update("address", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <label className="font-medium">Image URL (Optional)</label>
          <input value={form.image_url} onChange={(e) => update("image_url", e.target.value)} className="mt-1 w-full rounded border p-2" placeholder="https://..." />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <input id="is_market" type="checkbox" checked={form.is_market} onChange={(e) => update("is_market", e.target.checked)} className="h-4 w-4 rounded" />
          <label htmlFor="is_market">This is a market-style event</label>
        </div>
        <div>
          <label className="font-medium">Vendor ID (Optional)</label>
          <input value={form.vendor_id} onChange={(e) => update("vendor_id", e.target.value)} className="mt-1 w-full rounded border p-2" placeholder="Leave blank for a standalone event" />
        </div>

        {/* The coordinates input field has been removed. */}

        <div className="flex items-center gap-2 pt-2">
          <button disabled={saving} className="rounded bg-black text-white px-5 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? "Saving..." : "Create Event"}
          </button>
          <Link href="/admin/events" className="text-sm rounded px-4 py-2 bg-gray-100 hover:bg-gray-200">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}