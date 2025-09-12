"use client";

export type PinData = {
  vendorSlug: string;
  vendorName: string;
  title?: string | null;
  description?: string | null; // Add description here
  starts_at?: string;
  ends_at?: string;
  address?: string | null;
};

/**
 * Determines if an event is today, this weekend, or later.
 * @param startDate The event's starting date object.
 * @returns 'today' | 'weekend' | 'future'
 */
export function getEventTimeCategory(
  startDate?: Date
): "today" | "weekend" | "future" {
  if (!startDate || isNaN(startDate.getTime())) {
    return "future";
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate()
  );

  // Check if today
  if (eventDay.getTime() === today.getTime()) {
    return "today";
  }

  // Check if this weekend (upcoming Sat or Sun)
  const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
  const nextSaturday = new Date(today);
  nextSaturday.setDate(today.getDate() + daysUntilSaturday);

  const nextSunday = new Date(nextSaturday);
  nextSunday.setDate(nextSaturday.getDate() + 1);

  if (
    eventDay.getTime() === nextSaturday.getTime() ||
    eventDay.getTime() === nextSunday.getTime()
  ) {
    return "weekend";
  }

  return "future";
}

function fmtRange(starts?: string, ends?: string) {
  if (!starts) return "";
  try {
    const start = new Date(starts);
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    };
    if (!ends) return start.toLocaleString("en-US", options);

    const end = new Date(ends);
    // If same day, format as "Jan 1, 4:00 PM - 6:00 PM"
    if (start.toDateString() === end.toDateString()) {
      return `${start.toLocaleString("en-US", {
        ...options,
      })} - ${end.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })}`;
    }
    // Different days
    return `${start.toLocaleString("en-US", options)} - ${end.toLocaleString(
      "en-US",
      options
    )}`;
  } catch {
    return "";
  }
}

/**
 * Returns a detached HTMLElement you can pass to maplibre Popup#setDOMContent.
 * Keeps user-provided values safe by using textContent.
 */
export function createPinPopupContent(pin: PinData): HTMLElement {
  const category = getEventTimeCategory(
    pin.starts_at ? new Date(pin.starts_at) : undefined
  );

  let colorClass = "border-gray-300"; // Default (Future)
  if (category === "today") {
    colorClass = "border-green-500"; // Green for Today
  } else if (category === "weekend") {
    colorClass = "border-amber-500"; // Amber/Yellow for Weekend
  }

  const wrapper = document.createElement("div");
  wrapper.className = `relative w-56 rounded-md bg-white overflow-hidden ${colorClass} cursor-pointer`;

  const content = document.createElement("div");
  content.className = "p-1.5 pr-8 space-y-0.5";
  wrapper.appendChild(content);

  if (pin.title) {
    const titleEl = document.createElement("p");
    titleEl.className = "text-xs text-gray-700";
    titleEl.textContent = pin.title;
    content.appendChild(titleEl);
  }

  if (pin.vendorName && pin.vendorSlug) {
    const vendorLink = document.createElement("a");
    vendorLink.href = `/vendor/${pin.vendorSlug}`;
    vendorLink.className = "text-sm font-semibold hover:underline block"; // Added 'block' for better layout
    vendorLink.textContent = pin.vendorName;
    content.appendChild(vendorLink);
  }

  // Add the description element
  // const descriptionEl = document.createElement("p");
  // descriptionEl.className = "text-xs text-gray-600 mt-1";
  // descriptionEl.textContent = pin.description || "";
  // content.appendChild(descriptionEl);

  const timeEl = document.createElement("p");
  timeEl.className = "text-xs text-gray-500";
  timeEl.textContent = fmtRange(pin.starts_at, pin.ends_at);
  content.appendChild(timeEl);

  if (pin.address) {
    const addressEl = document.createElement("p");
    addressEl.className = "text-xs text-gray-500 mt-1";
    addressEl.textContent = pin.address;
    content.appendChild(addressEl);
  }

  const expandIcon = document.createElement("div");
  expandIcon.className = "absolute top-1/2 right-2 -translate-y-1/2 text-gray-400";
  expandIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  wrapper.appendChild(expandIcon);

  return wrapper;
}
