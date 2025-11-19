import { notFound } from "next/navigation";
import ExplorePage from "@/app/(app)/explore/page";
import MapPage from "@/app/(app)/map/page";

type Params = { id: string };
type SearchParams = { from?: string };

export const revalidate = 0;

// This page is now just a placeholder for the route.
// It should not render any UI, allowing the intercepted route to work
// without replacing the background content.
export default function EventPage() {
  return null;
}