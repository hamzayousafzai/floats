"use client";
import { useTransition } from "react";
import { signOut } from "@/app/actions/logout";

export default function SignOutButton({ next = "/" }: { next?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(async () => await signOut(next))}
      disabled={pending}
      className="text-sm underline"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
