"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";
import type { Database } from "@/lib/database.types";
import { toZonedTime, format } from "date-fns-tz";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type Category = { id: number; name: string; };

type Props = {
  event: EventRow;
  allCategories: Category[];
  currentCategoryIds: Set<number>;
};

type FormState = {
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  address: string;
  image_url: string;
  is_market: boolean;
  is_featured: boolean;
  category_ids: Set<number>;
  vendor_id: string;
  status: string;
  coords: string;
};

const TZ = "America/New_York";

export default function EditEventForm({ event, allCategories, currentCategoryIds }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Helper to convert UTC datetime string to NY wall-time for input
  const toInputDatetime = (v: string | null | undefined) => {
    if (!v) return "";
    try {
      const zoned = toZonedTime(v, TZ); // take stored UTC and view it in NY wall time
      return format(zoned, "yyyy-MM-dd'T'HH:mm"); // format for datetime-local input
    } catch (error) {
      console.error("Error formatting date:", v, error);
      return ""; // Fallback on error
    }
  };

  // Initialize form with non-null defaults
  const initialForm: FormState = {
    title: event.title ?? "",
    description: event.description ?? "",
    starts_at: toInputDatetime(event.starts_at),
    ends_at: toInputDatetime(event.ends_at),
    address: event.address ?? "",
    image_url: event.image_url ?? "",
    is_market: (event.is_market ?? false) as boolean,
    is_featured: (event.is_featured ?? false) as boolean,
    category_ids: new Set(currentCategoryIds ?? []),
    vendor_id: event.vendor_id ?? "",
    status: (event.status ?? "confirmed") as string,
    coords: "",
  };

  const [form, setForm] = useState<FormState>(initialForm);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleCategoryChange(categoryId: number, isChecked: boolean) {
    const newCategoryIds = new Set(form.category_ids);
    if (isChecked) {
      newCategoryIds.add(categoryId);
    } else {
      newCategoryIds.delete(categoryId);
    }
    update("category_ids", newCategoryIds);
  }

  // Handle file upload
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      const result = await response.json();
      if (result.url) {
        update("image_url", result.url);
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload image');
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, category_ids: Array.from(form.category_ids) };

      const res = await fetch(`/admin/events/${event.id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update event");
      
      alert("Event updated successfully!");
      router.push("/admin/events");
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Title */}
      <div>
        <label className="block text-sm font-medium mb-1">Title</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          className="input input-bordered w-full"
          required
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          className="textarea textarea-bordered w-full"
          rows={3}
        />
      </div>

      {/* Current Image Display & Upload */}
      <div>
        <label className="block text-sm font-medium mb-1">Event Image</label>
        
        {/* Current Image Preview */}
        {form.image_url && (
          <div className="mb-3">
            <p className="text-sm text-gray-600 mb-2">Current image:</p>
            <div className="relative w-full h-48 rounded-lg overflow-hidden border">
              <Image
                src={form.image_url}
                alt="Current event image"
                fill
                className="object-cover"
              />
            </div>
          </div>
        )}

        {/* File Upload Input */}
        <input
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          disabled={uploading}
          className="file-input file-input-bordered w-full"
        />
        
        {uploading && (
          <p className="text-sm text-blue-600 mt-1">Uploading image...</p>
        )}

        {/* Manual URL Input (fallback) */}
        <div className="mt-3">
          <label className="block text-xs text-gray-500 mb-1">Or enter image URL manually:</label>
          <input
            type="url"
            value={form.image_url}
            onChange={(e) => update("image_url", e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="input input-bordered input-sm w-full"
          />
        </div>
      </div>

      {/* Date/Time Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Starts At</label>
          <input
            type="datetime-local"
            value={form.starts_at}
            onChange={(e) => update("starts_at", e.target.value)}
            className="input input-bordered w-full"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Ends At</label>
          <input
            type="datetime-local"
            value={form.ends_at}
            onChange={(e) => update("ends_at", e.target.value)}
            className="input input-bordered w-full"
            required
          />
        </div>
      </div>

      {/* Address */}
      <div>
        <label className="block text-sm font-medium mb-1">Address</label>
        <input
          type="text"
          value={form.address}
          onChange={(e) => update("address", e.target.value)}
          className="input input-bordered w-full"
        />
      </div>

      {/* Checkboxes */}
      <div className="space-y-2">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={form.is_market}
            onChange={(e) => update("is_market", e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm">Is Market Event</span>
        </label>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={form.is_featured}
            onChange={(e) => update("is_featured", e.target.checked)}
            className="checkbox"
          />
          <span className="text-sm">Featured Event</span>
        </label>
      </div>

      {/* Categories */}
      <div>
        <label className="block text-sm font-medium mb-1">Categories</label>
        <div className="space-y-1">
          {allCategories.map((cat) => (
            <label key={cat.id} className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={form.category_ids.has(cat.id)}
                onChange={(e) => handleCategoryChange(cat.id, e.target.checked)}
                className="checkbox checkbox-sm"
              />
              <span className="text-sm">{cat.name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Status */}
      <div>
        <label className="block text-sm font-medium mb-1">Status</label>
        <select
          value={form.status}
          onChange={(e) => update("status", e.target.value)}
          className="select select-bordered w-full"
        >
          <option value="scheduled">Scheduled</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {/* Submit Button */}
      <div className="pt-4">
        <button
          type="submit"
          disabled={saving || uploading}
          className="btn btn-primary w-full"
        >
          {saving ? "Updating..." : "Update Event"}
        </button>
      </div>
    </form>
  );
}