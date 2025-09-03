"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import TypeChips from "./TypeChips";
import VendorCard from "./VendorCard";

type VendorCardData = {
  id: string;
  slug: string;
  name: string;
  category: string;
  photo_url: string | null;
  next: {
    starts_at: string;
    ends_at: string | null;
    address: string | null;
  } | null;
};

type Props = {
  vendors: VendorCardData[];
  favoriteIds: string[];
  typeOptions: string[];
};

export default function ExploreView({ vendors, favoriteIds, typeOptions }: Props) {
  const [selectedType, setSelectedType] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vendors.filter(v => {
      const matchesType = selectedType === "All" || v.category === selectedType;
      const matchesSearch = !q || v.name.toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [vendors, selectedType, searchQuery]);

  // Approx heights:
  // Nav bar: 64px
  // Sticky header (search + chips): ~120px (adjust if you change header layout)
  // We create a scrollable "boxed" list whose height = viewport - nav - header - safe-area
  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-b">
        <div className="mx-auto max-w-md w-full px-4 py-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search vendors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-full border bg-gray-50 pl-11 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/50"
            />
          </div>
          <TypeChips
            value={selectedType}
            onChange={setSelectedType}
            options={typeOptions}
          />
        </div>
      </div>

      {/* Boxed list container */}
      <main className="flex-1 px-4">
        <div className="mx-auto max-w-md pt-4 pb-4">
          <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            <div
              className="overflow-y-auto px-4 pt-2 pb-6 space-y-4"
              style={{
                // viewport height minus nav (64) minus header (~120)
                maxHeight: "calc(100vh - 64px - 120px - env(safe-area-inset-bottom))",
              }}
            >
              {filtered.map(v => (
                <VendorCard
                  key={v.id}
                  vendor={v}
                  isFavorite={favoriteIds.includes(v.id)}
                />
              ))}

              {filtered.length === 0 && (
                <div className="rounded-xl border border-dashed p-10 text-center text-sm text-gray-500">
                  No vendors found.
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}