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

