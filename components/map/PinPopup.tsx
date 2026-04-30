"use client";

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

export function fmtRange(starts?: string, ends?: string) {
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


