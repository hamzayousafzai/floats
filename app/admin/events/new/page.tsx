"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

type EventDateTime = {
  starts_at: string;
  ends_at: string;
};

export default function AdminNewEventPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [supabase] = useState(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ));

  const [form, setForm] = useState({
    title: "",
    description: "",
    address: "",
    vendor_name: "", // Changed from vendor_id
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isRecurring, setIsRecurring] = useState(false);
  const [datetimes, setDatetimes] = useState<EventDateTime[]>([
    { starts_at: "", ends_at: "" },
  ]);

  function updateForm<K extends keyof typeof form>(k: K, v: any) {
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

  function handleDateChange(index: number, field: keyof EventDateTime, value: string) {
    const newDatetimes = [...datetimes];
    newDatetimes[index][field] = value;
    setDatetimes(newDatetimes);
  }

  function addDate() {
    setDatetimes([...datetimes, { starts_at: "", ends_at: "" }]);
  }

  function removeDate(index: number) {
    setDatetimes(datetimes.filter((_, i) => i !== index));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      let imageUrl: string | null = null;

      if (imageFile) {
        const filePath = `public/${Date.now()}-${imageFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from("event-images")
          .upload(filePath, imageFile);

        if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
        
        const { data: urlData } = supabase.storage
          .from("event-images")
          .getPublicUrl(filePath);
        imageUrl = urlData.publicUrl;
      }

      // Create an array of event objects to insert
      const eventsToCreate = datetimes.map(dt => ({
        ...form,
        starts_at: dt.starts_at,
        ends_at: dt.ends_at || null,
        image_url: imageUrl,
      }));

      const res = await fetch("/admin/events/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventsToCreate), // Send array
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || "An unknown error occurred.");
      }
      
      router.push("/admin/events");
      router.refresh();
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
          <input required value={form.title} onChange={(e) => updateForm("title", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <label className="font-medium">Description</label>
          <textarea rows={4} value={form.description} onChange={(e) => updateForm("description", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <label className="font-medium">Address</label>
          <input required value={form.address} onChange={(e) => updateForm("address", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>
        <div>
          <label className="font-medium">Vendor Name</label>
          <input required value={form.vendor_name} onChange={(e) => updateForm("vendor_name", e.target.value)} className="mt-1 w-full rounded border p-2" />
        </div>

        {/* Date/Time Section */}
        <div className="p-4 border rounded-lg space-y-4">
          <div className="flex items-center gap-2">
            <input id="is_recurring" type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} className="h-4 w-4 rounded" />
            <label htmlFor="is_recurring">This is a recurring event</label>
          </div>
          
          {datetimes.map((dt, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label className="font-medium text-xs">Starts At</label>
                <input required type="datetime-local" value={dt.starts_at} onChange={(e) => handleDateChange(index, "starts_at", e.target.value)} className="mt-1 w-full rounded border p-2" />
              </div>
              <div className="flex gap-2">
                <div className="flex-grow">
                  <label className="font-medium text-xs">Ends At (Optional)</label>
                  <input type="datetime-local" value={dt.ends_at} onChange={(e) => handleDateChange(index, "ends_at", e.target.value)} className="mt-1 w-full rounded border p-2" />
                </div>
                {isRecurring && datetimes.length > 1 && (
                  <button type="button" onClick={() => removeDate(index)} className="btn btn-sm btn-square btn-ghost text-red-500">
                    &times;
                  </button>
                )}
              </div>
            </div>
          ))}

          {isRecurring && (
            <button type="button" onClick={addDate} className="btn btn-sm btn-outline">
              + Add another date
            </button>
          )}
        </div>

        <div>
          <label className="font-medium">Event Image (Optional)</label>
          <input type="file" accept="image/*" onChange={handleFileChange} className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          {imagePreview && <div className="mt-4"><img src={imagePreview} alt="Image preview" className="w-48 h-auto rounded-lg" /></div>}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button disabled={saving} className="rounded bg-black text-white px-5 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? "Saving..." : "Create Event(s)"}
          </button>
          <Link href="/admin/events" className="text-sm rounded px-4 py-2 bg-gray-100 hover:bg-gray-200">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}