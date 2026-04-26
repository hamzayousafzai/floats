"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Cropper, { type Area } from "react-easy-crop";
import Image from "next/image";

// Helper function to create a cropped image blob
const createCroppedImage = (
  imageSrc: string,
  pixelCrop: Area
): Promise<Blob | null> => {
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
      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        pixelCrop.width,
        pixelCrop.height
      );
      canvas.toBlob(
        (blob) => {
          resolve(blob);
        },
        "image/jpeg",
        0.9
      );
    };
  });
};

// 15-minute interval time slots for the time <select>
const pad = (n: number) => n.toString().padStart(2, "0");
const TIME_SLOTS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_SLOTS.push(`${pad(h)}:${pad(m)}`);
  }
}

// Format a 24h "HH:mm" slot to a 12h display label (e.g. "02:00" → "2:00 AM")
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
  if (m >= 60) return `${pad(h + 1 > 23 ? 0 : h + 1)}:00`;
  return `${pad(h)}:${pad(m)}`;
}

// Formats a Date object to YYYY-MM-DDTHH:mm (local time, safe for datetime-local inputs)
function formatLocalDatetime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Returns the Nth occurrence of a weekday in a given year/month (1-indexed)
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return new Date(year, month, day);
}

type EventDateTime = { starts_at: string; ends_at: string };
type MediaItem = { image_url: string; sort_index: number; file: Blob };
type Org = { id: string; name: string };

type GenPattern = "weekly" | "biweekly" | "monthly-date" | "monthly-weekday";

export default function AdminNewEventForm({ orgs }: { orgs: Org[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const defaultOrgId = process.env.NEXT_PUBLIC_FLOATS_PLATFORM_ORG_ID || "";

  const [form, setForm] = useState({
    title: "",
    description: "",
    address: "",
    org_id: defaultOrgId,
  });
  const [eventMedia, setEventMedia] = useState<MediaItem[]>([]);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const aspect = 16 / 9;
  const [isRecurring, setIsRecurring] = useState(false);
  const [datetimes, setDatetimes] = useState<EventDateTime[]>([
    { starts_at: "", ends_at: "" },
  ]);

  // --- Pattern generator state ---
  const [showGenerator, setShowGenerator] = useState(false);
  const [genPattern, setGenPattern] = useState<GenPattern>("weekly");
  const [genCount, setGenCount] = useState(4);
  const [genAppend, setGenAppend] = useState(false);

  const onCropComplete = useCallback(
    (croppedArea: Area, croppedAreaPixels: Area) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    []
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener(
        "load",
        () => setImageToCrop(reader.result as string),
        false
      );
      reader.readAsDataURL(file);
      e.target.value = "";
    }
  };

  const handleSaveCrop = async () => {
    if (!imageToCrop || !croppedAreaPixels) return;
    const croppedImageBlob = await createCroppedImage(imageToCrop, croppedAreaPixels);
    if (croppedImageBlob) {
      const newMediaItems = [...eventMedia];
      const imageUrl = URL.createObjectURL(croppedImageBlob);
      newMediaItems.push({
        image_url: imageUrl,
        file: croppedImageBlob,
        sort_index: newMediaItems.length,
      });
      setEventMedia(newMediaItems);
    }
    setImageToCrop(null);
  };

  const removeImage = (index: number) => {
    const newMedia = eventMedia.filter((_, i) => i !== index);
    const reindexedMedia = newMedia.map((item, idx) => ({ ...item, sort_index: idx }));
    setEventMedia(reindexedMedia);
  };

  function updateForm<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleDateChange(index: number, field: keyof EventDateTime, value: string) {
    const newDatetimes = [...datetimes];
    newDatetimes[index][field] = value;

    // Auto-set Ends At logic
    if (field === "starts_at" && value) {
      const startDate = new Date(value);
      if (!isNaN(startDate.getTime())) {
        const currentEnd = newDatetimes[index].ends_at;
        const endDate = currentEnd ? new Date(currentEnd) : null;

        // If end date is empty OR end date is before the new start date, auto-set it to start + 2 hours
        if (!currentEnd || (endDate && endDate < startDate)) {
          const newEndDate = new Date(startDate);
          newEndDate.setHours(newEndDate.getHours() + 2);
          newDatetimes[index].ends_at = formatLocalDatetime(newEndDate);
        }
      }
    }

    setDatetimes(newDatetimes);
  }

  // Copies the previous entry's times and advances the date by 7 days as a sensible default.
  // The admin only needs to adjust the date, not re-enter the time.
  function addDate() {
    const last = datetimes[datetimes.length - 1];

    if (last.starts_at) {
      const prevStart = new Date(last.starts_at);
      const nextStart = new Date(prevStart);
      nextStart.setDate(nextStart.getDate() + 7);

      let nextEnd = "";
      if (last.ends_at) {
        const prevEnd = new Date(last.ends_at);
        // Preserve the duration between start and end
        const durationMs = prevEnd.getTime() - prevStart.getTime();
        const nextEndDate = new Date(nextStart.getTime() + durationMs);
        nextEnd = formatLocalDatetime(nextEndDate);
      }

      setDatetimes([
        ...datetimes,
        { starts_at: formatLocalDatetime(nextStart), ends_at: nextEnd },
      ]);
    } else {
      setDatetimes([...datetimes, { starts_at: "", ends_at: "" }]);
    }
  }

  function removeDate(index: number) {
    setDatetimes(datetimes.filter((_, i) => i !== index));
  }

  // Generates a list of dates from the first entry's date/time using the selected pattern.
  function generateDates() {
    const base = datetimes[0];
    if (!base.starts_at) {
      alert("Set the first date before generating a pattern.");
      return;
    }

    const baseStart = new Date(base.starts_at);
    const baseEnd = base.ends_at ? new Date(base.ends_at) : null;
    const durationMs = baseEnd ? baseEnd.getTime() - baseStart.getTime() : 0;

    // Derive the Nth weekday for monthly-weekday pattern
    const weekday = baseStart.getDay();
    const occurrence = Math.floor((baseStart.getDate() - 1) / 7) + 1;

    const generated: EventDateTime[] = [base]; // always keep the first

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
        // Preserve original time
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

    if (genAppend) {
      // Append, but skip the first generated entry (same as base that's already there)
      setDatetimes([...datetimes, ...generated.slice(1)]);
    } else {
      setDatetimes(generated);
    }

    setShowGenerator(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      const uploadedMedia = await Promise.all(
        eventMedia.map(async (media) => {
          const formData = new FormData();
          formData.append("file", media.file, `upload-${media.sort_index}.jpg`);
          const res = await fetch("/api/upload", { method: "POST", body: formData });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || "Image upload failed");
          return { image_url: result.url, sort_index: media.sort_index };
        })
      );

      const eventsToCreate = datetimes.map((dt) => ({
        title: form.title,
        description: form.description,
        address: form.address,
        starts_at: dt.starts_at,
        ends_at: dt.ends_at || null,
      }));

      const finalPayload = {
        org_id: form.org_id,
        is_recurring: isRecurring,
        events: eventsToCreate,
        event_media: uploadedMedia,
      };

      const res = await fetch("/admin/events/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalPayload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || "An unknown error occurred.");
      }

      router.push("/admin/events");
      router.refresh();
    } catch (err: unknown) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  // Label shown for the monthly-weekday pattern option, derived from the first date entry
  const monthlyWeekdayLabel = (() => {
    if (!datetimes[0].starts_at) return "Monthly (Nth weekday)";
    const d = new Date(datetimes[0].starts_at);
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const ordinals = ["1st", "2nd", "3rd", "4th", "5th"];
    const n = Math.floor((d.getDate() - 1) / 7);
    return `Monthly (${ordinals[n]} ${days[d.getDay()]})`;
  })();

  return (
    <>
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
            <button onClick={() => setImageToCrop(null)} className="btn btn-ghost">
              Cancel
            </button>
            <button onClick={handleSaveCrop} className="btn btn-primary">
              Save Crop
            </button>
          </div>
        </div>
      )}

      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold mb-4">Create Event</h2>
        <form onSubmit={submit} className="space-y-4 text-sm">
          <div>
            <label className="font-medium">Title</label>
            <input
              required
              value={form.title}
              onChange={(e) => updateForm("title", e.target.value)}
              className="mt-1 w-full rounded border p-2"
            />
          </div>
          <div>
            <label className="font-medium">Description</label>
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) => updateForm("description", e.target.value)}
              className="mt-1 w-full rounded border p-2"
            />
          </div>
          <div>
            <label className="font-medium">Address</label>
            <input
              required
              value={form.address}
              onChange={(e) => updateForm("address", e.target.value)}
              className="mt-1 w-full rounded border p-2"
            />
          </div>

          <div>
            <label className="font-medium">Organization</label>
            <select
              required
              value={form.org_id}
              onChange={(e) => updateForm("org_id", e.target.value)}
              className="mt-1 w-full rounded border p-2 select select-bordered"
            >
              <option value="" disabled>Select an organization</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Defaults to the Floats Platform organization.</p>
          </div>

          {/* ── Date / Time section ── */}
          <div className="p-4 border rounded-lg space-y-4">
            <div className="flex items-center gap-2">
              <input
                id="is_recurring"
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              <label htmlFor="is_recurring">This is a recurring event</label>
              {isRecurring && datetimes.length > 1 && (
                <span className="ml-auto text-xs text-gray-500 font-medium">
                  {datetimes.length} dates
                </span>
              )}
            </div>

            {/* Date entries */}
            {datetimes.map((dt, index) => (
              <div key={index} className="space-y-2">
                <p className="font-medium text-xs">
                  {isRecurring ? `Occurrence ${index + 1}` : "Date & Time"}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Starts At */}
                  <div>
                    <label className="font-medium text-xs text-gray-500">Starts At</label>
                    <div className="mt-1 flex gap-1">
                      <input
                        required
                        type="date"
                        value={getDatePart(dt.starts_at)}
                        onChange={(e) => {
                          const t = getTimePart(dt.starts_at) || "09:00";
                          handleDateChange(index, "starts_at", `${e.target.value}T${t}`);
                        }}
                        className="flex-1 min-w-0 rounded border p-2 text-xs"
                      />
                      <select
                        required
                        value={getTimePart(dt.starts_at)}
                        onChange={(e) => {
                          const d = getDatePart(dt.starts_at);
                          if (d) handleDateChange(index, "starts_at", `${d}T${e.target.value}`);
                        }}
                        className="rounded border p-2 text-xs bg-white"
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
                      <label className="font-medium text-xs text-gray-500">Ends At (Optional)</label>
                      <div className="mt-1 flex gap-1">
                        <input
                          type="date"
                          value={getDatePart(dt.ends_at)}
                          min={getDatePart(dt.starts_at)}
                          onChange={(e) => {
                            const t = getTimePart(dt.ends_at) || getTimePart(dt.starts_at) || "11:00";
                            handleDateChange(index, "ends_at", `${e.target.value}T${t}`);
                          }}
                          className="flex-1 min-w-0 rounded border p-2 text-xs"
                        />
                        <select
                          value={getTimePart(dt.ends_at)}
                          onChange={(e) => {
                            const d = getDatePart(dt.ends_at) || getDatePart(dt.starts_at);
                            if (d) handleDateChange(index, "ends_at", `${d}T${e.target.value}`);
                          }}
                          className="rounded border p-2 text-xs bg-white"
                        >
                          <option value="" disabled>Time</option>
                          {TIME_SLOTS.map((slot) => (
                            <option key={slot} value={slot}>{formatTimeLabel(slot)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {isRecurring && datetimes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDate(index)}
                        className="btn btn-sm btn-square btn-ghost text-red-500"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Recurring controls */}
            {isRecurring && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={addDate}
                  className="btn btn-sm btn-outline"
                >
                  + Add date
                </button>
                <button
                  type="button"
                  onClick={() => setShowGenerator((v) => !v)}
                  className="btn btn-sm btn-ghost text-blue-600"
                >
                  {showGenerator ? "▲ Hide generator" : "▼ Generate from pattern"}
                </button>
                {datetimes.length >= 3 && (
                  <button
                    type="button"
                    onClick={() => setDatetimes([datetimes[0]])}
                    className="btn btn-sm btn-ghost text-red-500 ml-auto"
                  >
                    Clear all dates
                  </button>
                )}
              </div>
            )}

            {/* ── Bulk pattern generator panel ── */}
            {isRecurring && showGenerator && (
              <div className="mt-2 p-4 bg-base-200 rounded-lg space-y-3 text-sm">
                <p className="font-medium text-xs uppercase tracking-wide text-gray-500">
                  Generate from pattern
                </p>
                <p className="text-xs text-gray-500">
                  Uses the first date entry as the base. Time and duration are preserved across all generated dates.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-medium text-xs">Pattern</label>
                    <select
                      value={genPattern}
                      onChange={(e) => setGenPattern(e.target.value as GenPattern)}
                      className="mt-1 w-full rounded border p-2 select select-bordered select-sm"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Bi-weekly (every 2 weeks)</option>
                      <option value="monthly-date">Monthly (same date)</option>
                      <option value="monthly-weekday">{monthlyWeekdayLabel}</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-medium text-xs">Total occurrences</label>
                    <input
                      type="number"
                      min={2}
                      max={52}
                      value={genCount}
                      onChange={(e) => setGenCount(Math.max(2, Math.min(52, Number(e.target.value))))}
                      className="mt-1 w-full rounded border p-2"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="gen_append"
                    type="checkbox"
                    checked={genAppend}
                    onChange={(e) => setGenAppend(e.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  <label htmlFor="gen_append" className="text-xs">
                    Append to existing dates (otherwise replaces all)
                  </label>
                </div>

                <button
                  type="button"
                  onClick={generateDates}
                  className="btn btn-sm btn-primary"
                >
                  Generate {genCount} dates
                </button>
              </div>
            )}
          </div>

          {/* Multi Image Uploader */}
          <div>
            <label className="font-medium">Event Images (Max 4)</label>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4">
              {eventMedia.map((media, index) => (
                <div key={index} className="relative">
                  <div className="relative w-full h-24 rounded-lg overflow-hidden border">
                    <Image
                      src={media.image_url}
                      alt={`Event image ${index + 1}`}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute -top-2 -right-2 btn btn-xs btn-circle btn-error"
                  >
                    &times;
                  </button>
                  {index === 0 && (
                    <div className="absolute bottom-1 left-1 badge badge-primary badge-sm">
                      Primary
                    </div>
                  )}
                </div>
              ))}
            </div>
            {eventMedia.length < 4 && (
              <div className="mt-4">
                <label className="btn btn-outline w-full">
                  + Add Image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onFileChange}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              disabled={saving}
              className="rounded bg-black text-white px-5 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving..." : "Create Event(s)"}
            </button>
            <Link
              href="/admin/events"
              className="text-sm rounded px-4 py-2 bg-gray-100 hover:bg-gray-200"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}