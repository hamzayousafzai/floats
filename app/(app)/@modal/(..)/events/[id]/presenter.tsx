"use client";

import { notFound, useRouter } from "next/navigation";
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

export default function ModalPresenter({ event }: { event: EventRow | null }) {
  const router = useRouter();

  const close = () => {
    // Always normalize to /explore on close to avoid weird history edges
    router.replace("/explore");
  };
  
  if (!event) return notFound();

  return (
    <EventDetailModal
      key={event.id}
      event={event as any}
      onClose={close}
    />
  );
}