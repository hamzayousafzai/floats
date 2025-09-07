"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

export default function AdminNewEventPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  // Use createBrowserClient for client-side Supabase interactions
  const [supabase] = useState(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ));

  const [form, setForm] = useState({
    title: "",
    description: "",
    starts_at: "",
    ends_at: "",
    address: "",
    is_market: false,
    vendor_id: "",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  function update<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    if (file) {
      setImagePreview(URL.createObjectURL(file));
    } else {
      setImagePreview(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      let imageUrl: string | null = null;

      // 1. If an image file is selected, upload it first.
      if (imageFile) {
        const filePath = `public/${Date.now()}-${imageFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from("event-images")
          .upload(filePath, imageFile);

        if (uploadError) {
          throw new Error(`Image upload failed: ${uploadError.message}`);
        }

        // 2. Get the public URL of the uploaded file.
        const { data: urlData } = supabase.storage
          .from("event-images")
          .getPublicUrl(filePath);
        
        imageUrl = urlData.publicUrl;
      }

      // 3. Send the form data (with the new image URL) to your API route.
      const res = await fetch("/admin/events/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, image_url: imageUrl }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || "An unknown error occurred.");
      }
      
      router.push("/admin/events");
      router.refresh(); // Refresh server components on the target page
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

        {/* New File Input for Image Upload */}
        <div>
          <label className="font-medium">Event Image (Optional)</label>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {imagePreview && (
            <div className="mt-4">
              <img src={imagePreview} alt="Image preview" className="w-48 h-auto rounded-lg" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <input id="is_market" type="checkbox" checked={form.is_market} onChange={(e) => update("is_market", e.target.checked)} className="h-4 w-4 rounded" />
          <label htmlFor="is_market">This is a market-style event</label>
        </div>
        <div>
          <label className="font-medium">Vendor ID (Optional)</label>
          <input value={form.vendor_id} onChange={(e) => update("vendor_id", e.target.value)} className="mt-1 w-full rounded border p-2" placeholder="Leave blank for a standalone event" />
        </div>

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