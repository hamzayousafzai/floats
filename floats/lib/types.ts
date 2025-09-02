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
};

export type WhenFilter = "now" | "today" | "weekend";
