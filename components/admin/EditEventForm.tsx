"use client";

import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import Image from "next/image";
import type { Database } from "@/lib/database.types";
import { toZonedTime, format } from "date-fns-tz";
import Cropper, { type Area } from "react-easy-crop";

// Helper function to create a cropped image blob (moved here for component use)
const createCroppedImage = (imageSrc: string, pixelCrop: Area): Promise<Blob | null> => {
  return new Promise((resolve) => {
    // FIX: Use window.Image to avoid conflict with the imported Next.js Image component.
    const image = new window.Image();
    image.src = imageSrc;
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = pixelCrop.width;
      canvas.height = pixelCrop.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height);
      canvas.toBlob((blob) => { resolve(blob); }, "image/jpeg", 0.9);
    };
  });
};

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type MediaRow = Database["public"]["Tables"]["event_media"]["Row"];
// FIX: Change category id type to string to match parent pages
type Category = { id: string; name: string; };

// --- MODIFIED: Add role to Props ---
type Props = {
  event?: EventRow & { event_media: MediaRow[] | null };
  orgId?: string;
  allCategories: Category[];
  // FIX: Change currentCategoryIds to expect a Set of strings
  currentCategoryIds?: Set<string>;
  role?: Database['public']['Enums']['org_role'] | 'admin' | null; // Add role prop
};

// Define a new type for the media items in the form state
type MediaItem = {
  id?: string; // Existing media ID
  image_url: string;
  sort_index: number;
  file?: File | Blob; // Can be a File or a cropped Blob
};

type FormState = {
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  address: string;
  event_media: MediaItem[];
  is_market: boolean;
  is_featured: boolean;
  // FIX: Change category_ids to be a Set of strings
  category_ids: Set<string>;
  vendor_id: string | null;
  status: string;
  coords: string;
};

const TZ = "America/New_York";

export default function EditEventForm({ event, orgId, allCategories, currentCategoryIds, role }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const isEditing = !!event; // Determine if we are in "edit" or "create" mode

  // --- Cropper State ---
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const aspect = 16 / 9;

  const onCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);
  // --- End Cropper State ---

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

  // --- MODIFIED: Initialize form based on whether it's a new or existing event ---
  const initialForm: FormState = {
    title: event?.title ?? "",
    description: event?.description ?? "",
    starts_at: toInputDatetime(event?.starts_at),
    ends_at: toInputDatetime(event?.ends_at),
    address: event?.address ?? "",
    event_media: (event?.event_media || (event?.image_url ? [{ image_url: event.image_url, sort_index: 0 }] : []))
      .sort((a: { sort_index: number }, b: { sort_index: number }) => a.sort_index - b.sort_index),
    is_market: (event?.is_market ?? false) as boolean,
    is_featured: (event?.is_featured ?? false) as boolean,
    // FIX: Initialize with a Set of strings
    category_ids: new Set(currentCategoryIds ?? []),
    vendor_id: event?.vendor_id ?? "",
    status: (event?.status ?? "confirmed") as string,
    coords: "",
  };

  const [form, setForm] = useState<FormState>(initialForm);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  // FIX: Handle categoryId as a string
  function handleCategoryChange(categoryId: string, isChecked: boolean) {
    const newCategoryIds = new Set(form.category_ids);
    if (isChecked) {
      newCategoryIds.add(categoryId);
    } else {
      newCategoryIds.delete(categoryId);
    }
    update('category_ids', newCategoryIds);
  }

  // --- Updated Image Handling ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener("load", () => setImageToCrop(reader.result as string), false);
      reader.readAsDataURL(file);
      e.target.value = ""; // Clear input to allow re-selecting the same file
    }
  };

  const handleSaveCrop = async () => {
    if (!imageToCrop || !croppedAreaPixels) return;

    const croppedImageBlob = await createCroppedImage(imageToCrop, croppedAreaPixels);
    if (croppedImageBlob) {
      const newMediaItems: MediaItem[] = [...form.event_media];
      const imageUrl = URL.createObjectURL(croppedImageBlob);
      newMediaItems.push({
        image_url: imageUrl,
        file: croppedImageBlob,
        sort_index: newMediaItems.length,
      });
      update("event_media", newMediaItems);
    }
    // Close the cropper modal
    setImageToCrop(null);
  };

  function removeImage(index: number) {
    const newMedia = form.event_media.filter((_, i) => i !== index);
    // Re-index the remaining images
    const reindexedMedia = newMedia.map((item, idx) => ({ ...item, sort_index: idx }));
    update("event_media", reindexedMedia);
  }
  // --- End Updated Image Handling ---

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const uploadedMedia = await Promise.all(form.event_media.map(async (media) => {
        if (media.file) { // This is a new file that needs to be uploaded
          const formData = new FormData();
          formData.append('file', media.file);
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || 'Upload failed');
          return { ...media, image_url: result.url, file: undefined }; // Replace local URL with Supabase URL
        }
        return media; // This is an existing image
      }));

      // --- MODIFIED: Handle dynamic orgId and API endpoint ---
      const finalOrgId = event?.org_id || orgId;
      if (!finalOrgId) {
        throw new Error("Organization ID is missing. Cannot submit form.");
      }

      const body = { ...form, org_id: finalOrgId, event_media: uploadedMedia, category_ids: Array.from(form.category_ids) };

      const apiEndpoint = isEditing
        ? `/admin/events/${event.id}/update`
        : '/admin/events/new/submit';

      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to ${isEditing ? 'update' : 'create'} event`);
      
      alert(`Event ${isEditing ? 'updated' : 'created'} successfully!`);
      
      // --- MODIFIED: Redirect based on context ---
      if (isEditing) {
        router.push("/admin/events");
      } else {
        // For new events, we don't have the slug, so a refresh is a safe bet
        // to show the new event in the host's list.
        router.refresh();
        // A more specific redirect could be router.back() or to a known path
      }

    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Cropper Modal */}
      {imageToCrop && (
        <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex flex-col p-4">
          <div className="relative flex-grow">
            <Cropper
              image={imageToCrop}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className="flex-shrink-0 pt-4 flex justify-end gap-2">
            <button onClick={() => setImageToCrop(null)} className="btn btn-ghost">Cancel</button>
            <button onClick={handleSaveCrop} className="btn btn-primary">Save Crop</button>
          </div>
        </div>
      )}

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

        {/* Multi Image Uploader */}
        <div>
          <label className="block text-sm font-medium mb-1">Event Images (Max 4)</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {form.event_media.map((media, index) => (
              <div key={index} className="relative">
                <div className="relative w-full h-24 rounded-lg overflow-hidden border">
                  <Image src={media.image_url} alt={`Event image ${index + 1}`} fill className="object-cover" />
                </div>
                <button type="button" onClick={() => removeImage(index)} className="absolute -top-2 -right-2 btn btn-xs btn-circle btn-error">
                  &times;
                </button>
                {index === 0 && <div className="absolute bottom-1 left-1 badge badge-primary badge-sm">Primary</div>}
              </div>
            ))}
          </div>
          {form.event_media.length < 4 && (
            <div className="mt-4">
              <label className="btn btn-outline w-full">
                + Add Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>
          )}
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
        <div className="flex flex-col space-y-2">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input type="checkbox" className="checkbox" checked={form.is_market} onChange={(e) => update("is_market", e.target.checked)} />
            <span>Is Market Event</span>
          </label>
          {/* FIX: Conditionally render "Featured Event" checkbox for admins */}
          {role === 'admin' && (
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="checkbox" className="checkbox" checked={form.is_featured} onChange={(e) => update("is_featured", e.target.checked)} />
              <span>Featured Event</span>
            </label>
          )}
        </div>

        {/* Categories */}
        <div className="form-control">
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

        {/* --- MODIFIED: Submit Button Text --- */}
        <div className="pt-4">
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary w-full"
          >
            {saving ? (isEditing ? "Updating..." : "Creating...") : (isEditing ? "Update Event" : "Create Event")}
          </button>
        </div>
      </form>
    </>
  );
}