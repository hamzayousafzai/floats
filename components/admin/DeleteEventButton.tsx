"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  eventId: string;
};

export default function DeleteEventButton({ eventId }: Props) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this event? This cannot be undone.")) {
      setIsDeleting(true);
      try {
        const res = await fetch(`/admin/events/${eventId}/delete`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to delete event.");
        }
        // Refresh the page to show the updated list
        router.refresh();
      } catch (error: any) {
        alert(`Error: ${error.message}`);
      } finally {
        setIsDeleting(false);
      }
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={isDeleting}
      className="text-red-600 hover:underline disabled:text-gray-400 disabled:no-underline"
    >
      {isDeleting ? "Deleting..." : "Delete"}
    </button>
  );
}