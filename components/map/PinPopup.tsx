"use client";

export type PinData = {
  id: string; // Add id to make the card clickable
  vendorSlug: string;
  vendorName: string;
  title?: string | null;
  description?: string | null;
  starts_at?: string;
  ends_at?: string;
  address?: string | null;
  imageUrl?: string | null; // Add imageUrl for the card
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

  // --- NEW CARD-BASED DESIGN ---

  // Main wrapper: A DaisyUI card
  const wrapper = document.createElement("div");
  wrapper.className = "card card-compact w-64 bg-base-100 shadow-xl cursor-pointer";
  wrapper.dataset.eventId = pin.id; // Add event ID for click handling

  // Optional Image
  if (pin.imageUrl) {
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    img.src = pin.imageUrl;
    img.alt = pin.title ?? "Event image";
    img.className = "h-24 w-full object-cover";
    figure.appendChild(img);
    wrapper.appendChild(figure);
  }

  // Card Body for content
  const cardBody = document.createElement("div");
  cardBody.className = "card-body p-3"; // Use p-3 for compact padding
  wrapper.appendChild(cardBody);

  // Time Category Badge
  const badgeContainer = document.createElement("div");
  badgeContainer.className = "card-actions -mt-1 mb-1"; // Adjust positioning
  const badge = document.createElement("div");
  badge.className = "badge badge-outline text-xs";

  if (category === "today") {
    badge.classList.add("badge-success");
    badge.textContent = "Today";
  } else if (category === "weekend") {
    badge.classList.add("badge-warning");
    badge.textContent = "This Weekend";
  }
  // No badge for "future" to keep it clean
  if (category !== "future") {
    badgeContainer.appendChild(badge);
    cardBody.appendChild(badgeContainer);
  }

  // Title
  if (pin.title) {
    const titleEl = document.createElement("h2");
    titleEl.className = "card-title text-base leading-tight"; // Use card-title
    titleEl.textContent = pin.title;
    cardBody.appendChild(titleEl);
  }

  // Time Range
  const timeEl = document.createElement("p");
  timeEl.className = "text-xs text-base-content/70";
  timeEl.textContent = fmtRange(pin.starts_at, pin.ends_at);
  cardBody.appendChild(timeEl);

  // Address
  if (pin.address) {
    const addressEl = document.createElement("p");
    addressEl.className = "text-xs text-base-content/70 mt-1";
    addressEl.textContent = pin.address;
    cardBody.appendChild(addressEl);
  }

  // Expand Icon (as an affordance)
  const expandIcon = document.createElement("div");
  expandIcon.className = "absolute top-1/2 right-2 -translate-y-1/2 text-base-content/30";
  expandIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  wrapper.appendChild(expandIcon);

  return wrapper;
}
