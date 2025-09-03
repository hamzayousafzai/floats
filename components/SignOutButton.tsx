"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

export default function SignOutButton({ className = "" }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function handle() {
    setLoading(true);
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <button
      onClick={handle}
      disabled={loading}
      className={`rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 ${className}`}
    >
      {loading ? "..." : "Sign Out"}
    </button>
  );
}