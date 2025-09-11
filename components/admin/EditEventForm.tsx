"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Database } from "@/lib/database.types";

type EventRow = Database["public"]["Tables"]["events"]["Row"];

export default function EditEventForm({ event }: { event: EventRow }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: event.title,
    description: event.description || "",
    // Format date for <input type="datetime-local"> which requires YYYY-MM-DDTHH:mm
    starts_at: new Date(event.starts_at).toISOString().slice(0, 16),
    ends_at: event.ends_at ? new Date(event.ends_at).toISOString().slice(0, 16) : "",
    address: event.address,
    image_url: event.image_url || "",
    is_market: event.is_market,
    is_featured: event.is_featured,
    vendor_id: event.vendor_id || "",
    status: event.status,
    // Coords are for overriding location only, so it starts empty.
    // The original location is stored in the DB and will be kept unless new coords are entered.
    coords: "",
  });

  function update<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/admin/events/${event.id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update event");
      
      alert("Event updated successfully!");
      router.push("/admin/events"); // Go back to the list
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Edit Event: <span className="font-normal">{event.title}</span></h2>
      <form onSubmit={submit} className="space-y-4 text-sm">
        <div>
          <label className="font-medium">Title</label>
          <input required value={form.title} onChange={e=>update("title", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <label className="font-medium">Status</label>
          <select value={form.status} onChange={e=>update("status", e.target.value)} className="mt-1 w-full rounded border p-2 bg-white">
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="font-medium">Description</label>
          <textarea rows={3} value={form.description} onChange={e=>update("description", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="font-medium">Starts At</label>
            <input required type="datetime-local" value={form.starts_at} onChange={e=>update("starts_at", e.target.value)} className="mt-1 w-full rounded border p-2" />
          </div>
          <div>
            <label className="font-medium">Ends At</label>
            <input type="datetime-local" value={form.ends_at} onChange={e=>update("ends_at", e.target.value)} className="mt-1 w-full rounded border p-2" />
          </div>
        </div>
        <div>
          <label className="font-medium">Address</label>
          <input required value={form.address} onChange={e=>update("address", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <label className="font-medium">Image URL</label>
          <input value={form.image_url} onChange={e=>update("image_url", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div className="flex items-center gap-2">
          <input id="is_market" type="checkbox" checked={form.is_market} onChange={e=>update("is_market", e.target.checked)} />
          <label htmlFor="is_market">Is this a market-style event?</label>
        </div>
        <div className="flex items-center gap-2">
          <input id="is_featured" type="checkbox" checked={form.is_featured} onChange={e=>update("is_featured", e.target.checked)} />
          <label htmlFor="is_featured">Feature this event on the Explore page?</label>
        </div>
        <div>
          <label className="font-medium">Vendor ID (optional)</label>
          <input value={form.vendor_id} onChange={e=>update("vendor_id", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        
        <div className="p-3 border rounded bg-gray-50">
          <div>
            <label className="font-medium">Override Coordinates (optional)</label>
            <input 
              type="text" 
              placeholder="e.g., (35.2271, -80.8431)"
              value={form.coords} 
              onChange={e=>update("coords", e.target.value)} 
              className="mt-1 w-full rounded border p-2" 
            />
            <p className="text-xs text-gray-500 mt-1">Leave blank to keep the original location. Enter new coordinates to override.</p>
          </div>
        </div>

        <button disabled={saving} className="rounded bg-black text-white px-5 py-2 text-sm disabled:opacity-50">
          {saving ? "Saving..." : "Update Event"}
        </button>
      </form>
    </div>
  );
}