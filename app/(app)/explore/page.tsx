export const revalidate = 0;
export const dynamic = 'force-dynamic';

import { createSupabaseServer } from "@/lib/supabase/server";
import ExploreView from "@/components/explore/ExploreView";
import { ExploreCardData } from "@/components/explore/EventCard";
import { FeaturedCardData } from "@/components/explore/FeaturedEventCard";

// Define the search params type for clarity
type ExplorePageSearchParams = {
  search?: string;
  when?: string;
  areas?: string;
  categories?: string;
};

export default async function ExplorePage({ searchParams }: { searchParams: Promise<ExplorePageSearchParams>; }) {
  const supabase = createSupabaseServer();

  const sp = await searchParams;

  const { data: featuredEvents } = await supabase.rpc("get_featured_events", {
    p_when: sp.when ?? 'anytime',
  });

  // Call the new RPC with filters from the URL
  const { data: events, error } = await supabase.rpc("explore_events", {
    p_search_text: sp.search,
    p_when: sp.when ?? 'anytime',
    p_area_slugs: sp.areas?.split(','),
    p_category_slugs: sp.categories?.split(','),
  });

  if (error) {
    console.error("Error fetching explore events:", error);
    // You should handle this error gracefully in the UI
  }

  // Fetch user's favorites to pass to the cards
  const { data: favoritesData } = await supabase.auth.getUser().then(({ data: { user } }) => {
    return supabase.from("favorites").select('vendor_id').eq('user_id', user?.id ?? '');
  });
  const favoriteVendorIds = new Set(favoritesData?.map(f => f.vendor_id));

  const featuredCards: FeaturedCardData[] = featuredEvents ?? [];
  const cards: ExploreCardData[] = events ?? [];

  // Fetch all available areas and categories to pass to the filter UI
  const { data: areas } = await supabase.from("areas").select("name, slug").order("name");
  const { data: categories } = await supabase.from("categories").select("name, slug").order("name");

  // Map the results to the card data shape

  return (
    <ExploreView
      featuredCards={featuredCards}
      initialCards={cards}
      availableAreas={areas ?? []}
      availableCategories={categories ?? []}
    />
  );
}