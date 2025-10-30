import { notFound } from "next/navigation";
import ExplorePage from "@/app/(app)/explore/page";
import MapPage from "@/app/(app)/map/page";

type Params = { id: string };
type SearchParams = { from?: string };

export const revalidate = 0;

// This page no longer needs to load event data.
// Its only job is to render the correct background for a direct navigation.
export default async function EventPage({ searchParams }: { params: Promise<Params>, searchParams: Promise<SearchParams> }) {
  const { from } = await searchParams;

  // Conditionally render the background based on the 'from' query parameter.
  const background = from === '/map' 
    ? <MapPage /> 
    : <ExplorePage searchParams={Promise.resolve({})} />;

  return background;
}