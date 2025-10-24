import { Database } from "./database.types";

export type EventPin = {
  id: string;
  vendorSlug: string;
  vendorName: string;
  title: string | null;
  lat: number;
  lng: number;
  starts_at: string;
  ends_at: string;
  address: string | null;
  imageUrl?: string | null;
  description: string | null;
};

export type WhenFilter = "now" | "today" | "weekend";

// This is a custom type that combines org data with membership data.
export type OrgMember = {
  id: string;
  name: string;
  slug: string;
  // FIX: Use the generated Enum type from database.types.ts
  role: Database['public']['Enums']['org_role'] | 'admin';
};

// Event card shape used by carousels/modals (client-only UI)
export type ExploreCardData = {
  id: string;
  title: string;
  image_url: string | null;
  starts_at: string | null;      // must allow null
  ends_at?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  categories: string[];
  is_starred?: boolean;
  is_notified?: boolean;
  is_series_followed?: boolean;
  series_id?: string | null;
  event_media?: { image_url: string; sort_index: number }[] | null;
  is_past?: boolean;             // UI hint
};

