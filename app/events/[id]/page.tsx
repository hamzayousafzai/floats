import { createSupabaseServer } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import FavoriteButton from "@/components/FavoriteButton";
import NotificationBell from "@/components/NotificationBell";
import ShareButton from "@/components/ShareButton";
import { Calendar, MapPin, Download, Navigation } from "lucide-react";

type Props = {
  params: {
    id: string;
  };
};

export const revalidate = 0;

export default async function EventDetailPage({ params }: Props) {
  const supabase = await createSupabaseServer();

  const { data: event, error } = await supabase
    .from("events")
    .select(`
      *,
      vendor:vendors(*)
    `)
    .eq("id", params.id)
    .single();

  if (error || !event) {
    notFound();
  }

  const canGetDirections =
    Boolean(event.address) || (event.latitude && event.longitude);
  const getDirectionsUrl =
    event.latitude && event.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`
      : event.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          event.address
        )}`
      : "#";

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      {event.image_url ? (
        <div className="relative h-64 md:h-96 rounded-lg overflow-hidden mb-6 bg-gray-100">
          <Image
            src={event.image_url}
            alt={event.title ?? "event image"}
            fill
            className="object-cover"
            priority
          />
        </div>
      ) : null}

      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{event.title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Hosted by {event.vendor?.name ?? "Unknown"}
          </p>

          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-500" />
              <div>
                {event.starts_at
                  ? new Date(event.starts_at).toLocaleString("en-US", {
                      dateStyle: "full",
                      timeStyle: "short",
                    })
                  : "Time TBD"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gray-500" />
              <div>{event.address ?? "Online / TBD"}</div>
            </div>

            {event.description ? (
              <div className="whitespace-pre-wrap text-sm mt-2">
                {event.description}
              </div>
            ) : null}
          </div>
        </div>

        {/* Controls */}
        <aside className="flex flex-col items-end gap-3">

          <Link href="/explore" className="btn btn-outline btn-md">
              Explore All Events
          </Link>

          <div className="flex flex-col gap-2 mt-2 w-full">
            {canGetDirections && (
              <a
                href={getDirectionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline btn-sm"
              >
                <Navigation className="h-4 w-4 mr-2" /> Get Directions
              </a>
            )}

            <a
              href={`/api/events/${event.id}/ics?reminderDays=2`}
              className="btn btn-outline btn-sm"
              download
            >
              <Download className="h-4 w-4 mr-2" /> Add to Calendar
            </a>

            <ShareButton
              title={event.title}
              text={event.description ?? undefined}
              url={`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/events/${
                event.id
              }`}
              className="btn btn-outline btn-sm"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}