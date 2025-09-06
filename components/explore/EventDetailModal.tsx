"use client";

import { type ExploreCardData } from "./EventCard";
import { Calendar, MapPin, X } from "lucide-react";
import Image from "next/image";

type Props = {
  event: ExploreCardData | null;
  onClose: () => void;
};

export default function EventDetailModal({ event, onClose }: Props) {
  return (
    <dialog id="event_modal" className="modal" open={!!event}>
      {event && (
        <div className="modal-box">
          <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"><X /></button>
          {event.imageUrl && (
            <figure className="relative h-48 -mx-6 -mt-6 mb-4 bg-gray-200 rounded-t-lg overflow-hidden">
              <Image src={event.imageUrl} alt={event.title} layout="fill" objectFit="cover" />
            </figure>
          )}
          <h3 className="font-bold text-lg">{event.title}</h3>
          <p className="py-4 text-sm">{event.description || "No description available."}</p>
          <div className="mt-2 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-500" />
              <span>{new Date(event.starts_at).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gray-500" />
              <span>{event.address}</span>
            </div>
          </div>
          <div className="modal-action">
            <button onClick={onClose} className="btn">Close</button>
          </div>
        </div>
      )}
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}