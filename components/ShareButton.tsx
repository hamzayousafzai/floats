"use client";

import React, { useCallback } from "react";
import { Share2 } from "lucide-react";

export default function ShareButton({
  title,
  text,
  url,
  className = "",
}: {
  title?: string;
  text?: string;
  url: string;
  className?: string;
}) {
  const handleShare = useCallback(async () => {
    try {
      if ((navigator as any).share) {
        await (navigator as any).share({ title, text, url });
        return;
      }

      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
        // lightweight feedback; replace with your toast if available
        // eslint-disable-next-line no-alert
        alert("Event Link Copied");
        return;
      }

      // fallback copy
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        // eslint-disable-next-line no-alert
        alert("Event Link Copied");
      } finally {
        document.body.removeChild(ta);
      }
    } catch (err) {
      // console.error suppressed to keep UI clean; log if needed
    }
  }, [title, text, url]);

  return (
    <button type="button" onClick={handleShare} className={className}>
      <Share2 className="h-4 w-4 mr-2 inline-block" /> Share
    </button>
  );
}