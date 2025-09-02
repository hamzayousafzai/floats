"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const siteUrl =
    typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_SITE_URL || "";

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${siteUrl}/auth/callback`, // important for SSR session
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      setError(err.message ?? "Failed to send magic link.");
    }
  }

  async function handleGithub() {
    setError(null);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
      },
    });
    if (error) setError(error.message);
    // user will be redirected by Supabase
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border rounded-xl p-6 space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>

        <form onSubmit={handleMagicLink} className="space-y-3">
          <label className="block text-sm">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2"
              placeholder="you@example.com"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
            disabled={!email || sent}
          >
            {sent ? "Link sent ✓" : "Send magic link"}
          </button>
        </form>

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="h-px bg-gray-200 flex-1" />
          OR
          <div className="h-px bg-gray-200 flex-1" />
        </div>

        <button
          onClick={handleGithub}
          className="w-full rounded border py-2"
        >
          Continue with GitHub
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <p className="text-xs text-gray-500">
          After verifying, you’ll be redirected back automatically.
        </p>
      </div>
    </main>
  );
}
