"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { DistanceFilter } from "./MapFilters";
import type { Area } from "@/components/filters/AreaFilters";

type Props = {
  open: boolean;
  onClose: () => void;
  distance: DistanceFilter;
  onDistanceChange: (d: DistanceFilter) => void;
  areas: Area[];
  selectedAreas: Set<string>;
  onAreaChange: (selected: Set<string>) => void;
};

const DISTANCE_OPTIONS: { label: string; value: DistanceFilter }[] = [
  { label: "5 mi", value: "5" },
  { label: "10 mi", value: "10" },
  { label: "20 mi", value: "20" },
];

export default function MapFilterSheet({
  open,
  onClose,
  distance,
  onDistanceChange,
  areas,
  selectedAreas,
  onAreaChange,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const toggleArea = (slug: string) => {
    if (slug === "all") {
      onAreaChange(new Set());
      return;
    }
    const next = new Set(selectedAreas);
    next.has(slug) ? next.delete(slug) : next.add(slug);
    onAreaChange(next);
  };

  const isActive = distance !== "5" || selectedAreas.size > 0;

  const handleClear = () => {
    onDistanceChange("5");
    onAreaChange(new Set());
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed bottom-0 inset-x-0 m-0 max-w-full w-full rounded-t-3xl bg-base-100 p-0 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      style={{ maxHeight: "80dvh" }}
    >
      <div className="flex flex-col max-h-[80dvh]">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-base-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-base-200 shrink-0">
          <span className="text-base font-semibold text-base-content">Filters</span>
          <div className="flex items-center gap-3">
            {isActive && (
              <button
                onClick={handleClear}
                className="text-sm text-primary font-medium"
              >
                Clear all
              </button>
            )}
            <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
          {/* Distance — When is controlled by the time pill in the map toolbar */}
          <section>
            <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-3">
              Distance
            </p>
            <div className="flex gap-2">
              {DISTANCE_OPTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => onDistanceChange(value)}
                  className={`btn btn-sm rounded-full ${
                    distance === value ? "btn-primary" : "btn-outline btn-ghost"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Areas */}
          <section>
            <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-3">
              Area
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => toggleArea("all")}
                className={`btn btn-sm rounded-full ${
                  selectedAreas.size === 0 ? "btn-primary" : "btn-outline btn-ghost"
                }`}
              >
                All Areas
              </button>
              {areas.map(({ name, slug }) => (
                <button
                  key={slug}
                  onClick={() => toggleArea(slug)}
                  className={`btn btn-sm rounded-full ${
                    selectedAreas.has(slug)
                      ? "btn-primary"
                      : "btn-outline btn-ghost"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-base-200">
          <button onClick={onClose} className="btn btn-primary w-full rounded-xl">
            Show Results
          </button>
        </div>
      </div>
    </dialog>
  );
}
