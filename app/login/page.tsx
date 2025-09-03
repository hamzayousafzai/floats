"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const router = useRouter();

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
      // First try as existing email
      let { data, error: vErr } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code,
        type: "email",
      });
      // If fails, attempt signup type (new user)
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
        router.replace("/profile");
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
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border rounded-xl p-6 space-y-6">
        <h1 className="text-xl font-semibold">Sign in</h1>

        {step === "request" && (
          <form onSubmit={requestCode} className="space-y-4">
            <label className="block text-sm">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full border rounded px-3 py-2"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
              disabled={!email || sent}
            >
              {sent ? "Code sent ✓" : "Send code"}
            </button>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={verifyCode} className="space-y-4">
            <div className="text-sm text-gray-600">
              We sent a 6‑digit code to
              <span className="font-medium"> {email}</span>
            </div>
            <label className="block text-sm">
              Code
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="mt-1 tracking-widest text-center text-lg font-medium w-full border rounded px-3 py-2"
                placeholder="••••••"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
              disabled={code.length !== 6 || verifying}
            >
              {verifying ? "Verifying..." : "Verify"}
            </button>
            <div className="flex justify-between text-xs text-gray-500">
              <button
                type="button"
                onClick={() => setStep("request")}
                className="underline"
              >
                Change email
              </button>
              <button
                type="button"
                onClick={resend}
                disabled={resending}
                className="underline disabled:opacity-50"
              >
                {resending ? "Resending..." : "Resend code"}
              </button>
            </div>
          </form>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <p className="text-xs text-gray-500">
          Enter your email to receive a one‑time code. No password required.
        </p>
      </div>
    </main>
  );
}