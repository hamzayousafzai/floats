"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import EventDetailModal from "@/components/explore/EventDetailModal";

type EventRow = {
  id: string;
  title: string | null;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
};

type PresenterProps = {
  event: EventRow | null;
};

export default function ModalPresenter({ event }: PresenterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallbackPath = searchParams.get("from") || "/explore"; // Read the 'from' param, default to /explore

  const close = () => {
    console.log("[ModalPresenter] close() called");
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
      event={event as any}
      onClose={close}
    />
  );
}