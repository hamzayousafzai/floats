import { toDate } from 'date-fns-tz';

/**
 * Safely converts a datetime-local string (wall-clock time in America/New_York) 
 * to a full UTC ISO string for database storage.
 * 
 * If the input string already contains timezone information (e.g., 'Z' or an offset),
 * it is returned as-is to prevent double-conversion.
 * 
 * @param dateTimeString The string from the datetime-local input.
 * @returns A UTC ISO string, or the original string if it's null/undefined or already has a timezone.
 */
export function convertToUTC(dateTimeString: string | null | undefined): string | null | undefined {
  if (!dateTimeString) {
    return dateTimeString;
  }

  // Check if the string already has timezone info (ends in Z or has +/- offset)
  const hasTimezone = /[zZ]$|[+\-]\d{2}(:?\d{2})?$/.test(dateTimeString);

  if (hasTimezone) {
    // It's already a full ISO string, don't convert it again.
    return dateTimeString;
  }

  // It's a "wall clock" time, so interpret it as New York time and get the UTC equivalent.
  try {
    const zonedDate = toDate(dateTimeString, { timeZone: 'America/New_York' });
    return zonedDate.toISOString();
  } catch (error) {
    console.error("Failed to convert date string to UTC:", dateTimeString, error);
    // Return the original string on error to avoid crashing
    return dateTimeString;
  }
}