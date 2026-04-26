"use client";

import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import Image from "next/image";
import type { Database } from "@/lib/database.types";
import { toZonedTime, format } from "date-fns-tz";
import Cropper, { type Area } from "react-easy-crop";
import { Plus, Trash2 } from "lucide-react";
import { useHost } from "@/lib/contexts/HostContext";
import { createPortal } from "react-dom";

// Helper function to create a cropped image blob (moved here for component use)
const createCroppedImage = (imageSrc: string, pixelCrop: Area): Promise<Blob | null> => {
  return new Promise((resolve) => {
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

// 15-minute interval time slots for the time <select>
const padTwo = (n: number) => n.toString().padStart(2, "0");
const TIME_SLOTS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_SLOTS.push(`${padTwo(h)}:${padTwo(m)}`);
  }
}

// Format a 24h "HH:mm" slot to a 12h display label
function formatTimeLabel(slot: string): string {
  const [hStr, mStr] = slot.split(":");
  const h = parseInt(hStr, 10);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

// Extract YYYY-MM-DD from a YYYY-MM-DDTHH:mm string
function getDatePart(dt: string): string {
  return dt ? dt.slice(0, 10) : "";
}

// Extract HH:mm from a YYYY-MM-DDTHH:mm string, snapped to nearest 15-min slot
function getTimePart(dt: string): string {
  if (!dt || !dt.includes("T")) return "";
  const [, time] = dt.split("T");
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = Math.round(parseInt(mStr, 10) / 15) * 15;
  if (m >= 60) return `${padTwo(h + 1 > 23 ? 0 : h + 1)}:00`;
  return `${padTwo(h)}:${padTwo(m)}`;
}

// Formats a Date to YYYY-MM-DDTHH:mm (local time, safe for datetime-local inputs)
function formatLocalDatetime(date: Date): string {
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}T${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

// Returns the Nth occurrence of a weekday in a given year/month (1-indexed n)
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return new Date(year, month, day);
}

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type MediaRow = Database["public"]["Tables"]["event_media"]["Row"];
type Category = { id: string; name: string; };
type Org = Database["public"]["Tables"]["orgs"]["Row"];

type Props = {
  event?: EventRow & { event_media: MediaRow[] | null };
  orgId?: string;
  allCategories: Category[];
  currentCategoryIds?: Set<string>;
  role?: Database['public']['Enums']['org_role'] | 'admin' | null;
  orgs?: Org[];
};

type MediaItem = {
  id?: string;
  image_url: string;
  sort_index: number;
  file?: File | Blob;
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
  org_id: string;
};

type GenPattern = "weekly" | "biweekly" | "monthly-date" | "monthly-weekday";

const TZ = "America/New_York";

export default function EditEventForm({ event, orgId, allCategories, currentCategoryIds, role, orgs = [] }: Props) {
  const router = useRouter();
  const isEditing = !!event;

  const { currentOrg } = useHost();
  const hostOrgId = currentOrg?.id ?? null;
  const orgSlug = currentOrg?.slug ?? "";

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
    org_id: event?.org_id ?? hostOrgId ?? orgId ?? "",
  };

  const [form, setForm] = useState<FormState>(initialForm);
  const [isRecurring, setIsRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // --- Pattern generator state ---
  const [showGenerator, setShowGenerator] = useState(false);
  const [genPattern, setGenPattern] = useState<GenPattern>("weekly");
  const [genCount, setGenCount] = useState(4);
  const [genAppend, setGenAppend] = useState(false);

  // --- Cropper State ---
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const aspect = 16 / 9;

  const onCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function handleDateChange(index: number, field: 'starts_at' | 'ends_at', value: string) {
    const newDates = [...form.dates];
    newDates[index][field] = value;

    if (field === "starts_at" && value) {
      const startDate = new Date(value);
      if (!isNaN(startDate.getTime())) {
        const currentEnd = newDates[index].ends_at;
        const endDate = currentEnd ? new Date(currentEnd) : null;

        if (!currentEnd || (endDate && endDate < startDate)) {
          const newEndDate = new Date(startDate);
          newEndDate.setHours(newEndDate.getHours() + 2);
          newDates[index].ends_at = formatLocalDatetime(newEndDate);
        }
      }
    }

    update('dates', newDates);
  }

  // Copies the previous entry's times and advances the date by 7 days as a sensible default.
  // The admin/host only needs to adjust the date, not re-enter the time.
  function addDate() {
    const last = form.dates[form.dates.length - 1];

    if (last.starts_at) {
      const prevStart = new Date(last.starts_at);
      const nextStart = new Date(prevStart);
      nextStart.setDate(nextStart.getDate() + 7);

      let nextEnd = "";
      if (last.ends_at) {
        const prevEnd = new Date(last.ends_at);
        const durationMs = prevEnd.getTime() - prevStart.getTime();
        nextEnd = formatLocalDatetime(new Date(nextStart.getTime() + durationMs));
      }

      update('dates', [...form.dates, { starts_at: formatLocalDatetime(nextStart), ends_at: nextEnd }]);
    } else {
      update('dates', [...form.dates, { starts_at: "", ends_at: "" }]);
    }
  }

  function removeDate(index: number) {
    if (form.dates.length > 1) {
      update('dates', form.dates.filter((_, i) => i !== index));
    }
  }

  // Generates dates from the first entry using the selected pattern.
  function generateDates() {
    const base = form.dates[0];
    if (!base.starts_at) {
      alert("Set the first date before generating a pattern.");
      return;
    }

    const baseStart = new Date(base.starts_at);
    const baseEnd = base.ends_at ? new Date(base.ends_at) : null;
    const durationMs = baseEnd ? baseEnd.getTime() - baseStart.getTime() : 0;

    const weekday = baseStart.getDay();
    const occurrence = Math.floor((baseStart.getDate() - 1) / 7) + 1;

    const generated: { starts_at: string; ends_at: string }[] = [base];

    for (let i = 1; i < genCount; i++) {
      let nextStart: Date;

      if (genPattern === "weekly") {
        nextStart = new Date(baseStart);
        nextStart.setDate(baseStart.getDate() + i * 7);
      } else if (genPattern === "biweekly") {
        nextStart = new Date(baseStart);
        nextStart.setDate(baseStart.getDate() + i * 14);
      } else if (genPattern === "monthly-date") {
        nextStart = new Date(baseStart);
        nextStart.setMonth(baseStart.getMonth() + i);
      } else {
        // monthly-weekday: Nth [weekday] of month
        const targetMonth = baseStart.getMonth() + i;
        const targetYear = baseStart.getFullYear() + Math.floor(targetMonth / 12);
        nextStart = getNthWeekdayOfMonth(targetYear, targetMonth % 12, weekday, occurrence);
        nextStart.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);
      }

      const nextEnd = baseEnd && durationMs > 0
        ? new Date(nextStart.getTime() + durationMs)
        : null;

      generated.push({
        starts_at: formatLocalDatetime(nextStart),
        ends_at: nextEnd ? formatLocalDatetime(nextEnd) : "",
      });
    }

    update('dates', genAppend ? [...form.dates, ...generated.slice(1)] : generated);
    setShowGenerator(false);
  }

  function handleCategoryChange(categoryId: string, isChecked: boolean) {
    const newCategoryIds = new Set(form.category_ids);
    if (isChecked) {
      newCategoryIds.add(categoryId);
    } else {
      newCategoryIds.delete(categoryId);
    }
    update('category_ids', newCategoryIds);
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener("load", () => setImageToCrop(reader.result as string), false);
      reader.readAsDataURL(file);
      e.target.value = "";
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
    setImageToCrop(null);
  };

  function removeImage(index: number) {
    const newMedia = form.event_media.filter((_, i) => i !== index);
    update("event_media", newMedia.map((item, idx) => ({ ...item, sort_index: idx })));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const uploadedMedia = await Promise.all(form.event_media.map(async (media) => {
        if (media.file) {
          const formData = new FormData();
          formData.append('file', media.file);
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || 'Upload failed');
          return { ...media, image_url: result.url, file: undefined };
        }
        return media;
      }));

      const finalOrgId = form.org_id;
      if (!finalOrgId) throw new Error("Organization ID is missing.");

      let apiEndpoint: string;
      let body: unknown;

      if (isEditing) {
        apiEndpoint = `/admin/events/${event.id}/update`;
        body = {
          ...form,
          starts_at: form.dates[0].starts_at,
          ends_at: form.dates[0].ends_at,
          event_media: uploadedMedia,
          category_ids: Array.from(form.category_ids),
          dates: undefined,
        };
      } else {
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
      if (!res.ok) throw new Error((result as { error?: string }).error || "Submission failed");

      alert(`Event ${isEditing ? 'updated' : 'created'} successfully!`);

      if (role === 'admin') {
        router.push('/admin/events');
      } else {
        router.push(`/host/${orgSlug}`);
      }

      router.refresh();

    } catch (err: unknown) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  const canPublish = role === 'admin' || role === 'owner';
  const canArchive = role === 'admin' || role === 'owner';
  const canChangeStatus = role !== 'editor';

  // Dynamic label for monthly-weekday pattern, derived from the first date entry
  const monthlyWeekdayLabel = (() => {
    if (!form.dates[0]?.starts_at) return "Monthly (Nth weekday)";
    const d = new Date(form.dates[0].starts_at);
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const ordinals = ["1st", "2nd", "3rd", "4th", "5th"];
    const n = Math.floor((d.getDate() - 1) / 7);
    return `Monthly (${ordinals[n]} ${days[d.getDay()]})`;
  })();

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
                <button type="button" onClick={() => setImageToCrop(null)} className="btn btn-ghost">
                  Cancel
                </button>
                <button type="button" onClick={handleSaveCrop} className="btn btn-primary">
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

        {/* Organization Dropdown — admin only */}
        {role === "admin" && orgs.length > 0 && (
          <div>
            <label htmlFor="org_id" className="block text-sm font-medium mb-1">Organization</label>
            <select
              id="org_id"
              name="org_id"
              value={form.org_id}
              onChange={(e) => update("org_id", e.target.value)}
              className="select select-bordered w-full"
              required
            >
              <option value="" disabled>Select an organization</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
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
                <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
              </label>
            </div>
          )}
        </div>

        {/* ── Recurring toggle (create only) ── */}
        {!isEditing && (
          <div className="form-control">
            <label className="cursor-pointer label justify-start gap-2 p-0">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={() => setIsRecurring(!isRecurring)}
                className="checkbox"
              />
              <span className="label-text">This is a recurring event</span>
              {isRecurring && form.dates.length > 1 && (
                <span className="ml-2 text-xs text-gray-500 font-medium">{form.dates.length} dates</span>
              )}
            </label>
          </div>
        )}

        {/* ── Date entries ── */}
        <div className="space-y-4">
          {(isRecurring && !isEditing ? form.dates : [form.dates[0]]).map((date, index) => (
            <div key={index} className="space-y-2">
              <p className="block text-sm font-medium">
                {isRecurring && !isEditing ? `Occurrence ${index + 1}` : "Date & Time"}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Starts At */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Starts At</label>
                  <div className="flex gap-1">
                    <input
                      required
                      type="date"
                      value={getDatePart(date.starts_at)}
                      onChange={(e) => {
                        const t = getTimePart(date.starts_at) || "09:00";
                        handleDateChange(index, 'starts_at', `${e.target.value}T${t}`);
                      }}
                      className="input input-bordered input-sm flex-1 min-w-0"
                    />
                    <select
                      required
                      value={getTimePart(date.starts_at)}
                      onChange={(e) => {
                        const d = getDatePart(date.starts_at);
                        if (d) handleDateChange(index, 'starts_at', `${d}T${e.target.value}`);
                      }}
                      className="select select-bordered select-sm"
                    >
                      <option value="" disabled>Time</option>
                      {TIME_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>{formatTimeLabel(slot)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* Ends At */}
                <div className="flex gap-1 items-end">
                  <div className="flex-grow">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Ends At</label>
                    <div className="flex gap-1">
                      <input
                        required
                        type="date"
                        value={getDatePart(date.ends_at)}
                        min={getDatePart(date.starts_at)}
                        onChange={(e) => {
                          const t = getTimePart(date.ends_at) || getTimePart(date.starts_at) || "11:00";
                          handleDateChange(index, 'ends_at', `${e.target.value}T${t}`);
                        }}
                        className="input input-bordered input-sm flex-1 min-w-0"
                      />
                      <select
                        required
                        value={getTimePart(date.ends_at)}
                        onChange={(e) => {
                          const d = getDatePart(date.ends_at) || getDatePart(date.starts_at);
                          if (d) handleDateChange(index, 'ends_at', `${d}T${e.target.value}`);
                        }}
                        className="select select-bordered select-sm"
                      >
                        <option value="" disabled>Time</option>
                        {TIME_SLOTS.map((slot) => (
                          <option key={slot} value={slot}>{formatTimeLabel(slot)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {isRecurring && !isEditing && form.dates.length > 1 && (
                    <button type="button" onClick={() => removeDate(index)} className="btn btn-ghost btn-square">
                      <Trash2 size={18} className="text-red-500" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Recurring controls */}
          {isRecurring && !isEditing && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" onClick={addDate} className="btn btn-sm btn-outline">
                <Plus size={16} className="mr-1" />
                Add date
              </button>
              <button
                type="button"
                onClick={() => setShowGenerator((v) => !v)}
                className="btn btn-sm btn-ghost text-blue-600"
              >
                {showGenerator ? "▲ Hide generator" : "▼ Generate from pattern"}
              </button>
              {form.dates.length >= 3 && (
                <button
                  type="button"
                  onClick={() => update('dates', [form.dates[0]])}
                  className="btn btn-sm btn-ghost text-red-500 ml-auto"
                >
                  Clear all dates
                </button>
              )}
            </div>
          )}

          {/* ── Bulk pattern generator panel ── */}
          {isRecurring && !isEditing && showGenerator && (
            <div className="p-4 bg-base-200 rounded-lg space-y-3 text-sm">
              <p className="font-medium text-xs uppercase tracking-wide text-gray-500">
                Generate from pattern
              </p>
              <p className="text-xs text-gray-500">
                Uses the first date entry as the base. Time and duration are preserved across all generated dates.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Pattern</label>
                  <select
                    value={genPattern}
                    onChange={(e) => setGenPattern(e.target.value as GenPattern)}
                    className="select select-bordered select-sm w-full"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly (every 2 weeks)</option>
                    <option value="monthly-date">Monthly (same date)</option>
                    <option value="monthly-weekday">{monthlyWeekdayLabel}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Total occurrences</label>
                  <input
                    type="number"
                    min={2}
                    max={52}
                    value={genCount}
                    onChange={(e) => setGenCount(Math.max(2, Math.min(52, Number(e.target.value))))}
                    className="input input-bordered input-sm w-full"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  id="gen_append"
                  type="checkbox"
                  checked={genAppend}
                  onChange={(e) => setGenAppend(e.target.checked)}
                  className="checkbox checkbox-sm"
                />
                <span className="text-xs">Append to existing dates (otherwise replaces all)</span>
              </label>

              <button type="button" onClick={generateDates} className="btn btn-sm btn-primary">
                Generate {genCount} dates
              </button>
            </div>
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
        {canChangeStatus && (
          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
              className="select select-bordered w-full"
            >
              <option value="draft">Draft</option>
              {canPublish && <option value="published">Published</option>}
              {canArchive && <option value="archived">Archived</option>}
            </select>
          </div>
        )}

        <div className="pt-4">
          <button type="submit" disabled={saving} className="btn btn-primary w-full">
            {saving ? (isEditing ? "Updating..." : "Creating...") : (isEditing ? "Update Event" : "Create Event")}
          </button>
        </div>
      </form>
    </>
  );
}