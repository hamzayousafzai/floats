"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

function isMobileUA() {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

type Props = {
  eventId: string;
  startsAt?: string | null;
  endsAt?: string | null;
  autoRun?: boolean;
  initialChecked?: boolean;
  onAuthRedirect?: (redirectAction: () => void) => void;
  disabled?: boolean; // Add disabled prop
};

export default function CheckInButton({
  eventId,
  startsAt,
  endsAt,
  autoRun = false,
  initialChecked = false,
  onAuthRedirect,
  disabled = false, // Destructure and default the disabled prop
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const allowDesktop =
    searchParams.get("allowDesktop") === "1" ||
    process.env.NEXT_PUBLIC_CHECKIN_ALLOW_DESKTOP === "true";

  const debugClient =
    searchParams.get("debug") === "1" ||
    process.env.NEXT_PUBLIC_CHECKIN_DEBUG === "true";

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);
  const [permState, setPermState] = useState<"prompt" | "granted" | "denied" | null>(null);
  const [alreadyChecked, setAlreadyChecked] = useState<boolean>(initialChecked); // NEW

  const insecure =
    typeof window !== "undefined" &&
    !window.isSecureContext &&
    window.location.hostname !== "localhost";

  useEffect(() => {
    setGeoReady(typeof navigator !== "undefined" && "geolocation" in navigator);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if ("permissions" in navigator && (navigator as any).permissions?.query) {
          const result = await (navigator as any).permissions.query({ name: "geolocation" });
          setPermState(result.state);
          (result as any).onchange = () => setPermState((result as any).state);
        }
      } catch {
        // Permissions API not available
      }
    })();
  }, []);

  const inWindow = (() => {
    if (!startsAt || !endsAt) return false;
    const now = Date.now();
    const s = new Date(startsAt).getTime();
    const e = new Date(endsAt).getTime();
    return now >= s && now <= e;
  })();

  const visible = (isMobileUA() || allowDesktop) && geoReady && inWindow;

  useEffect(() => {
    setAlreadyChecked(initialChecked);
  }, [initialChecked]);

  useEffect(() => {
    if (visible && autoRun && !alreadyChecked && status !== "success") {
      submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoRun, alreadyChecked]);

  function submit() {
    if (insecure) {
      setStatus("insecure_context");
      return;
    }

    if (permState === "denied") {
      if (debugClient) console.warn("[check-in][client] geolocation permission denied");
      setStatus("permission_denied");
      return;
    }

    setBusy(true);
    setStatus(null);

    // iOS Safari: must call getCurrentPosition synchronously in click handler
    if (debugClient) console.debug("[check-in][client] requesting geolocation…");
    
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          if (debugClient) {
            console.debug("[check-in][client] geolocation result", {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: pos.coords.accuracy,
            });
          }

          // Now check auth after we have location
          const supabase = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
          );
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            const search = window.location.search;
            const returnTo = `${window.location.pathname}${search ? search + "&" : "?"}doCheckIn=1`;
            if (debugClient) console.debug("[check-in][client] not authenticated → redirecting", { returnTo });

            const redirectAction = () => {
              router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
            };

            if (onAuthRedirect) {
              onAuthRedirect(redirectAction);
            } else {
              redirectAction();
            }

            setBusy(false);
            return;
          }

          const res = await fetch("/api/check-in", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              event_id: eventId,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null,
              method: "web",
              source: "browser_geolocation",
            }),
          });

          if (res.status === 401) {
            const search = window.location.search;
            const returnTo = `${window.location.pathname}${search ? search + "&" : "?"}doCheckIn=1`;
            if (debugClient) console.debug("[check-in][client] 401 → redirecting", { returnTo });
            
            const redirectAction = () => {
              router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
            };

            if (onAuthRedirect) {
              onAuthRedirect(redirectAction);
            } else {
              redirectAction();
            }

            setBusy(false);
            return;
          }

          const text = await res.clone().text();
          let json: any = null;
          try { json = JSON.parse(text); } catch {}
          if (debugClient) console.debug("[check-in][client] api response", { status: res.status, body: json ?? text });

          if (!res.ok) {
            setStatus(json?.code === "outside_geofence" ? "outside_geofence" : "generic_error");
          } else {
            setStatus("success");
            setAlreadyChecked(true); // NEW: lock UI after success
          }
        } catch (e: any) {
          if (debugClient) console.error("[check-in][client] error", e);
          setStatus("generic_error");
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        if (debugClient) console.error("[check-in][client] geolocation error", err);
        setBusy(false);
        
        if (err.code === 1) {
          setStatus("permission_denied");
        } else if (err.code === 3) {
          setStatus("timeout");
        } else {
          setStatus("generic_error");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 12000,
      }
    );
  }

  if (!visible) return null;

  const isChecked = alreadyChecked || status === "success";
  const label = isChecked ? "Checked In" : busy ? "Checking in…" : "Check In";

  const errorText: string | null =
    status === "permission_denied"
      ? "Location is blocked for this site. Enable it in your browser settings and try again."
      : status === "insecure_context"
      ? "Location requires HTTPS. Use a secure connection (or localhost in dev)."
      : status === "outside_geofence"
      ? "You appear to be outside the event’s check‑in area."
      : status === "timeout"
      ? "Location request timed out. Try again near a window with better signal."
      : status === "generic_error"
      ? "Couldn't check in. Please try again."
      : null;

  function onClickCheckedSafe() {
    if (busy || isChecked || disabled) return; // Add disabled check here
    submit();
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClickCheckedSafe}
        // Combine busy and disabled states
        disabled={busy || disabled}
        aria-disabled={isChecked || disabled ? true : undefined}
        tabIndex={isChecked || disabled ? -1 : undefined}
        className={
          "btn w-full " +
          (isChecked
            ? "btn-success text-white font-semibold border-none pointer-events-none cursor-default"
            : "btn-primary")
        }
        title={isChecked ? "Already checked in" : undefined}
        aria-live="polite"
      >
        {isChecked ? (
          <>
            <svg
              className="inline-block w-5 h-5 mr-2 -ml-1"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Checked In
          </>
        ) : busy ? "Checking in…" : "Check In"}
      </button>

      <p className="mt-2 text-xs text-base-content/60">
        We’ll use your location once to verify you’re at the event.
      </p>

      {errorText && (
        <p role="alert" className="mt-2 text-sm text-error">
          {errorText}
        </p>
      )}
    </div>
  );
}