"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter, useSearchParams } from "next/navigation";

// The component contains all the logic from your original page.
export default function LoginForm() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true, // allow signup if new
        },
      });
      if (error) throw error;
      setSent(true);
      setStep("verify");
    } catch (err: any) {
      setError(err.message || "Failed to send code.");
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6‑digit code.");
      return;
    }
    setVerifying(true);
    try {
      let { data, error: vErr } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code,
        type: "email",
      });
      if (vErr) {
        const retry = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: code,
          type: "signup",
        });
        data = retry.data;
        vErr = retry.error;
      }
      if (vErr) throw vErr;
      if (data?.session) {
        const nextUrl = searchParams.get('next');
        router.replace(nextUrl || "/profile");
      } else {
        setError("Invalid or expired code.");
      }
    } catch (err: any) {
      setError(err.message || "Could not verify code.");
    } finally {
      setVerifying(false);
    }
  }

  async function resend() {
    if (resending) return;
    setResending(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || "Failed to resend.");
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-base-200">
      <div className="w-full max-w-md rounded-xl p-6 space-y-6 shadow border border-base-300 bg-base-300 text-base-content">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Join Floats</h1>
          <p className="mt-2 text-sm text-base-content/70">
            Discover local markets and pop-ups in Charlotte. Save your favorites, set reminders, and never miss out.
          </p>
        </div>

        {step === "request" && (
          <form onSubmit={requestCode} className="space-y-4">
            <label className="block text-sm">
              Enter your email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input input-bordered mt-1 w-full bg-base-200 placeholder:text-base-content/50"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={!email || sent}
            >
              {sent ? "Code sent ✓" : "Send code"}
            </button>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={verifyCode} className="space-y-4">
            <div className="text-sm text-base-content/70 text-center">
              We sent a 6‑digit code to
              <span className="font-medium"> {email}</span>
            </div>
            <label className="block text-sm">
              Verification Code
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="input input-bordered mt-1 w-full text-center tracking-widest text-lg font-medium bg-base-200 placeholder:text-base-content/50"
                placeholder="••••••"
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={code.length !== 6 || verifying}
            >
              {verifying ? "Verifying..." : "Verify & Sign In"}
            </button>
            <div className="flex justify-between text-xs">
              <button
                type="button"
                onClick={() => setStep("request")}
                className="btn btn-link btn-xs text-base-content/70"
              >
                Change email
              </button>
              <button
                type="button"
                onClick={resend}
                disabled={resending}
                className="btn btn-link btn-xs text-base-content/70 disabled:opacity-50"
              >
                {resending ? "Resending..." : "Resend code"}
              </button>
            </div>
          </form>
        )}

        {error && <p className="text-sm text-error text-center">{error}</p>}

        <p className="text-xs text-base-content/60 text-center">
          Enter your email to receive a one‑time code. No password required.
        </p>
      </div>
    </main>
  );
}