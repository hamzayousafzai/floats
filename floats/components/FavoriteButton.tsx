"use client";

import { useOptimistic, useTransition } from "react";

type Props = {
  vendorId: string;
  initial: boolean;
  action: (vendorId: string, revalidate?: string | string[]) => Promise<{ ok: boolean; favorited: boolean }>;
  revalidatePaths?: string | string[];
  size?: "sm" | "md";
};

export default function FavoriteButton({ vendorId, initial, action, revalidatePaths, size = "md" }: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(initial, (_state, next: boolean) => next);

  const label = optimistic ? "Unfavorite" : "Favorite";

  function onClick() {
    startTransition(() => {
      // optimistic flip immediately (INSIDE the transition)
      setOptimistic(!optimistic);

      // run the server action, then settle the optimistic state
      action(vendorId, revalidatePaths)
        .then((res) => {
          setOptimistic(res.favorited);
        })
        .catch(() => {
          // rollback on error
          setOptimistic(initial);
        });
    });
  }

  return (
    <button
      disabled={isPending}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${optimistic ? "bg-black text-white" : "bg-white"}`}
      aria-pressed={optimistic}
      aria-label={label}
      title={label}
    >
      {isPending ? "…" : optimistic ? "★ Favorited" : "☆ Favorite"}
    </button>
  );
}
