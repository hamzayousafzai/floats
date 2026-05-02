"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import EventDetailModal from "@/components/explore/EventDetailModal";
import type { ExploreCardData } from "@/lib/types";

type PresenterProps = {
  event: ExploreCardData | null;
};

export default function ModalPresenter({ event }: PresenterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallbackPath = searchParams.get("from") || "/explore"; // Read the 'from' param, default to /explore

  const close = () => {
    // Check if we can go back in history.
    const idx = typeof window !== "undefined" ? (window.history.state?.idx ?? 0) : 0;
    if (idx > 0) {
      router.back();
    } else {
      // If not, use the fallback path from the URL.
      router.replace(fallbackPath);
    }
  };

  useEffect(() => {
    if (!event) {
      close();
    }
  }, [event]);

  if (!event) {
    return null;
  }

  return (
    <EventDetailModal
      event={event}
      onClose={close}
    />
  );
}