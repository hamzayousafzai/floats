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
};

export default function CheckInButton({ eventId, startsAt, endsAt, autoRun = false }: Props) {
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
    if (visible && autoRun) {
      submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoRun]);

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
            router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
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
            router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
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

  const label =
    status === "success" ? "Checked In" : busy ? "Checking in…" : "Check In";

  let errorText: string | null = null;
  if (status === "permission_denied") {
    errorText = "Location is blocked for this site. Enable it in your browser settings and try again.";
  } else if (status === "insecure_context") {
    errorText = "Location requires HTTPS. Use a secure connection (or localhost in dev).";
  } else if (status === "outside_geofence") {
    errorText = "You appear to be outside the event's check‑in area.";
  } else if (status === "timeout") {
    errorText = "Location request timed out. Try again near a window with better signal.";
  } else if (status === "generic_error") {
    errorText = "Couldn't check in. Please try again.";
  }

  return (
    <div>
      <button
        type="button"
        onClick={submit}
        disabled={busy || status === "success"}
        className="btn btn-primary w-full"
        aria-live="polite"
      >
        {label}
      </button>
      <p className="mt-2 text-xs text-base-content/60">We'll use your location once to verify you're at the event.</p>
      {errorText && (
        <div className="mt-2">
          <p role="alert" className="text-sm text-error">{errorText}</p>
          {status === "permission_denied" && (
            <ul className="mt-2 text-xs text-base-content/60 list-disc pl-4 space-y-1">
              <li>Chrome: lock icon → Site settings → Location → Allow.</li>
              <li>iOS Safari: Settings → Privacy & Security → Location Services → Safari → While Using the App.</li>
              <li>Ensure Location Services are enabled on the device.</li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}