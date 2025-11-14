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

type EventDateTime = { starts_at: string; ends_at: string };
type MediaItem = { image_url: string; sort_index: number; file: Blob };
type Org = { id: string; name: string }; // Add this type

// The component is now named AdminNewEventForm and accepts `orgs`
export default function AdminNewEventForm({ orgs }: { orgs: Org[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // Get the default org ID from environment variables
  const defaultOrgId = process.env.NEXT_PUBLIC_FLOATS_PLATFORM_ORG_ID || "";

  const [form, setForm] = useState({
    title: "",
    description: "",
    address: "",
    // REMOVED: vendor_name: "",
    org_id: defaultOrgId, // NEW: Add org_id and set its default
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

  function updateForm<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
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
        // REMOVED: vendor_name: form.vendor_name,
        org_id: form.org_id, // NEW: Pass the selected org_id
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
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

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
            <button
              onClick={() => setImageToCrop(null)}
              className="btn btn-ghost"
            >
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
          
          {/* REPLACED "Vendor Name" with "Organization" dropdown */}
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
            </div>
            {datetimes.map((dt, index) => (
              <div
                key={index}
                className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end"
              >
                <div>
                  <label className="font-medium text-xs">Starts At</label>
                  <input
                    required
                    type="datetime-local"
                    value={dt.starts_at}
                    onChange={(e) =>
                      handleDateChange(index, "starts_at", e.target.value)
                    }
                    className="mt-1 w-full rounded border p-2"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-grow">
                    <label className="font-medium text-xs">Ends At (Optional)</label>
                    <input
                      type="datetime-local"
                      value={dt.ends_at}
                      onChange={(e) =>
                        handleDateChange(index, "ends_at", e.target.value)
                      }
                      className="mt-1 w-full rounded border p-2"
                    />
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
            ))}
            {isRecurring && (
              <button
                type="button"
                onClick={addDate}
                className="btn btn-sm btn-outline"
              >
                + Add another date
              </button>
            )}
          </div>

          {/* Multi Image Uploader */}
          <div>
            <label className="font-medium">Event Images (Max 4)</label>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4">
              {eventMedia.map((media, index) => (
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