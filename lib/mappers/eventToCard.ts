import { ExploreCardData } from "@/components/explore/VendorCard";

// This file is now for all mappers that create Explore Cards

/**
 * Maps a standalone event from the database to the ExploreCardData shape.
 */
export function mapEventRow(event: any): ExploreCardData {
  return {
    id: event.id,
    slug: `events/${event.id}`, // A slug for URL purposes
    name: event.title,
    category: event.is_market ? "Market" : "Event",
    photo_url: event.image_url || null,
    isEvent: true, // This is a standalone event
    next: {
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      address: event.address,
    },
  };
}

/**
 * Maps a vendor and its next event to the ExploreCardData shape.
 */
export function mapVendorRow(vendor: any, nextEvent: any | null): ExploreCardData {
  return {
    id: vendor.id,
    slug: vendor.slug,
    name: vendor.name,
    category: vendor.category,
    photo_url: vendor.photo_url || null,
    isEvent: false, // This is a vendor, not a standalone event
    next: nextEvent
      ? {
          starts_at: nextEvent.starts_at,
          ends_at: nextEvent.ends_at,
          address: nextEvent.address,
        }
      : null,
  };
}