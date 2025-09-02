"use client";

import { useMemo, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import TypeChips from "./TypeChips";
import VendorCard, { type VendorCardData } from "./VendorCard";
import FavoriteButton from "@/components/FavoriteButton";
import { toggleFavorite } from "@/app/actions/favorites";

export default function ExploreView({
  vendors,
  typeOptions = ["All", "Jewelry", "Vintage", "Food"],
  favoriteIds = [],
}: {
  vendors: VendorCardData[];
  typeOptions?: string[];
  favoriteIds?: string[]; // 👈 serializable from server
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const filtered = useMemo(() => {
    let list = vendors;
    if (type !== "All") list = list.filter(v => (v.category || "").toLowerCase() === type.toLowerCase());
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(v => v.name.toLowerCase().includes(q));
    }
    return list.map(v => ({ ...v, isFavorite: favSet.has(v.id) }));
  }, [vendors, type, query, favSet]);

  return (
    <div className="mx-auto max-w-screen-sm p-4 space-y-4">
      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
        <input
          className="w-full rounded-lg border bg-gray-50 pl-9 pr-3 py-2 text-sm"
          placeholder="Search vendors"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Filters */}
      <TypeChips value={type} onChange={setType} options={typeOptions} />

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3">
        {filtered.map((v) => (
          <div key={v.id} className="relative">
            <VendorCard v={v} />
            <div className="absolute top-3 right-3">
              <FavoriteButton
                vendorId={v.id}
                initial={!!v.isFavorite}
                action={toggleFavorite}
                revalidatePaths={["/explore", `/vendor/${v.slug}`, "/profile"]}
                size="sm"
              />
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-sm text-gray-500 py-12 text-center">No vendors match your filters.</div>
        )}
      </div>
    </div>
  );
}
