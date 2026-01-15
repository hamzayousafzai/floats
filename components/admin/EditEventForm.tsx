"use client";

import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import Image from "next/image";
import type { Database } from "@/lib/database.types";
import { toZonedTime, format } from "date-fns-tz";
import Cropper, { type Area } from "react-easy-crop";
import { Plus, Trash2 } from "lucide-react";
import { useHost } from "@/lib/contexts/HostContext";
import { createPortal } from "react-dom";  // ADD

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
type Category = { id: string; name: string; };
type Org = Database["public"]["Tables"]["orgs"]["Row"]; // Add Org type

// --- MODIFIED: Add role to Props ---
type Props = {
  event?: EventRow & { event_media: MediaRow[] | null };
  orgId?: string;
  allCategories: Category[];
  // FIX: Change currentCategoryIds to expect a Set of strings
  currentCategoryIds?: Set<string>;
  role?: Database['public']['Enums']['org_role'] | 'admin' | null; // Add role prop
  orgs?: Org[]; // Add orgs prop
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
  dates: { starts_at: string; ends_at: string }[];
  address: string;
  event_media: MediaItem[];
  is_market: boolean;
  is_featured: boolean;
  category_ids: Set<string>;
  vendor_id: string | null;
  status: string;
  coords: string;
  // --- FIX 1: Add org_id to the form state ---
  org_id: string;
};

const TZ = "America/New_York";

export default function EditEventForm({ event, orgId, allCategories, currentCategoryIds, role, orgs = [] }: Props) {
  const router = useRouter();
  const isEditing = !!event;

  // FIX: derive org info from Host context (used for submit + redirect)
  const { currentOrg } = useHost();
  const hostOrgId = currentOrg?.id ?? null;
  const orgSlug = currentOrg?.slug ?? "";

  // MOVE this helper above initialForm so it’s defined before use
  const toInputDatetime = (v: string | null | undefined) => {
    if (!v) return "";
    try {
      const zoned = toZonedTime(v, TZ);
      return format(zoned, "yyyy-MM-dd'T'HH:mm");
    } catch (error) {
      console.error("Error formatting date:", v, error);
      return "";
    }
  };

  const initialForm: FormState = {
    title: event?.title ?? "",
    description: event?.description ?? "",
    dates: isEditing && event
      ? [{ starts_at: toInputDatetime(event.starts_at), ends_at: toInputDatetime(event.ends_at) }]
      : [{ starts_at: "", ends_at: "" }],
    address: event?.address ?? "",
    event_media: event?.event_media?.map(media => ({
      id: media.id,
      image_url: media.image_url,
      sort_index: media.sort_index,
    })) ?? [],
    is_market: (event?.is_market ?? false) as boolean,
    is_featured: (event?.is_featured ?? false) as boolean,
    category_ids: new Set(currentCategoryIds ?? []),
    vendor_id: event?.vendor_id ?? "",
    status: (event?.status ?? "draft") as string,
    coords: "",
    // --- FIX 2: Initialize org_id in the form state ---
    // Use the event's org_id if editing, otherwise fall back.
    org_id: event?.org_id ?? hostOrgId ?? orgId ?? "",
  };

  const [form, setForm] = useState<FormState>(initialForm);
  // FIX: Add state for the recurring checkbox, only relevant for new events
  const [isRecurring, setIsRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  // --- FIX: Add functions to manage the dates array ---
  function handleDateChange(index: number, field: 'starts_at' | 'ends_at', value: string) {
    const newDates = [...form.dates];
    newDates[index][field] = value;

    // Auto-set Ends At logic
    if (field === "starts_at" && value) {
      const startDate = new Date(value);
      if (!isNaN(startDate.getTime())) {
        const currentEnd = newDates[index].ends_at;
        const endDate = currentEnd ? new Date(currentEnd) : null;

        // If end date is empty OR end date is before the new start date, auto-set it to start + 2 hours
        if (!currentEnd || (endDate && endDate < startDate)) {
          const newEndDate = new Date(startDate);
          newEndDate.setHours(newEndDate.getHours() + 2);

          // Format to YYYY-MM-DDTHH:mm manually to preserve local time values
          const pad = (n: number) => n.toString().padStart(2, "0");
          const formattedEnd = `${newEndDate.getFullYear()}-${pad(newEndDate.getMonth() + 1)}-${pad(newEndDate.getDate())}T${pad(newEndDate.getHours())}:${pad(newEndDate.getMinutes())}`;
          
          newDates[index].ends_at = formattedEnd;
        }
      }
    }

    update('dates', newDates);
  }

  function addDate() {
    update('dates', [...form.dates, { starts_at: "", ends_at: "" }]);
  }

  function removeDate(index: number) {
    if (form.dates.length > 1) {
      const newDates = form.dates.filter((_, i) => i !== index);
      update('dates', newDates);
    }
  }
  // --- End Date Management ---

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
      // --- FIX 4: Use the org_id FROM THE FORM STATE ---
      const finalOrgId = form.org_id;
      if (!finalOrgId) throw new Error("Organization ID is missing.");

      let apiEndpoint: string;
      let body: any;

      if (isEditing) {
        // --- UPDATE LOGIC (Single Event) ---
        apiEndpoint = `/admin/events/${event.id}/update`;
        body = {
          ...form,
          starts_at: form.dates[0].starts_at,
          ends_at: form.dates[0].ends_at,
          // The org_id from the form state is already in '...form', so this is correct.
          event_media: uploadedMedia,
          category_ids: Array.from(form.category_ids),
          dates: undefined, // Clean up payload
        };
      } else {
        // --- CREATE LOGIC (Single or Recurring) ---
        apiEndpoint = '/admin/events/new/submit';
        body = {
          org_id: finalOrgId,
          is_recurring: isRecurring,
          events: (isRecurring ? form.dates : [form.dates[0]]).map(d => ({
            title: form.title,
            description: form.description,
            starts_at: d.starts_at,
            ends_at: d.ends_at,
            address: form.address,
            is_market: form.is_market,
            is_featured: form.is_featured,
            status: form.status,
          })),
          event_media: uploadedMedia,
          category_ids: Array.from(form.category_ids),
        };
      }

      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Submission failed");

      alert(`Event ${isEditing ? 'updated' : 'created'} successfully!`);
      
      // --- THE FIX: Conditional Redirect ---
      if (role === 'admin') {
        // If the user is a global admin, redirect to the admin events page.
        router.push('/admin/events');
      } else {
        // Otherwise, use the existing logic for host users.
        router.push(`/host/${orgSlug}`);
      }
      
      router.refresh();

    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  // --- Role-based permissions ---
  const canPublish = role === 'admin' || role === 'owner';
  const canArchive = role === 'admin' || role === 'owner';
  // An editor can only edit, not change status from draft/published.
  const canChangeStatus = role !== 'editor';

  return (
    <>
      {/* Cropper Modal */}
      {imageToCrop && typeof window !== "undefined" &&
        createPortal(
          (
            <div className="fixed inset-0 bg-black z-[99999] flex flex-col p-4">
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
                <button
                  type="button"                        // ADD
                  onClick={() => setImageToCrop(null)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"                        // ADD
                  onClick={handleSaveCrop}
                  className="btn btn-primary"
                >
                  Save Crop
                </button>
              </div>
            </div>
          ),
          document.body
        )
      }

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

        {/* Organization Dropdown - Conditionally rendered for platform admins */}
        {role === "admin" && orgs.length > 0 && (
          <div>
            <label htmlFor="org_id" className="block text-sm font-medium mb-1">
              Organization
            </label>
            {/* --- FIX 3: Make the select a controlled component --- */}
            <select
              id="org_id"
              name="org_id"
              value={form.org_id} // Use value from state
              onChange={(e) => update("org_id", e.target.value)} // Update state on change
              className="select select-bordered w-full"
              required
            >
              <option value="" disabled>Select an organization</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        )}

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

        {/* --- RECURRING & DATE FIELDS --- */}
        {!isEditing && (
          <div className="form-control">
            <label className="cursor-pointer label justify-start gap-2 p-0">
              <input type="checkbox" checked={isRecurring} onChange={() => setIsRecurring(!isRecurring)} className="checkbox" />
              <span className="label-text">This is a recurring event</span>
            </label>
          </div>
        )}

        <div className="space-y-4">
          {(isRecurring && !isEditing ? form.dates : [form.dates[0]]).map((date, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                {index === 0 && <label className="block text-sm font-medium mb-1">Starts At</label>}
                <input
                  type="datetime-local"
                  step="900"
                  value={date.starts_at}
                  onChange={(e) => handleDateChange(index, 'starts_at', e.target.value)}
                  className="input input-bordered w-full"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-grow">
                  {index === 0 && <label className="block text-sm font-medium mb-1">Ends At</label>}
                  <input
                    type="datetime-local"
                    step="900"
                    value={date.ends_at}
                    min={date.starts_at} /* Enforce end date cannot be before start date in UI */
                    onChange={(e) => handleDateChange(index, 'ends_at', e.target.value)}
                    className="input input-bordered w-full"
                    required
                  />
                </div>
                {isRecurring && !isEditing && form.dates.length > 1 && (
                  <button type="button" onClick={() => removeDate(index)} className="btn btn-ghost btn-square">
                    <Trash2 size={18} className="text-red-500" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {isRecurring && !isEditing && (
            <button type="button" onClick={addDate} className="btn btn-sm btn-outline mt-2">
              <Plus size={16} className="mr-1" />
              Add another date
            </button>
          )}
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
        {/* FIX: Conditionally render the status dropdown based on role and use new values */}
        {canChangeStatus && (
          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
              className="select select-bordered w-full"
            >
              <option value="draft">Draft</option>
              {/* Only show 'Published' and 'Archived' to users with permission */}
              {canPublish && <option value="published">Published</option>}
              {canArchive && <option value="archived">Archived</option>}
            </select>
          </div>
        )}

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