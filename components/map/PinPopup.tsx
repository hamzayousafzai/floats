"use client";

export type PinData = {
  vendorSlug: string;
  vendorName: string;
  title?: string | null;
  starts_at?: string;
  ends_at?: string;
  address?: string | null;
};

function fmtRange(starts?: string, ends?: string) {
  if (!starts || !ends) return null;
  try {
    const s = new Date(starts);
    const e = new Date(ends);
    return `${s.toLocaleString()} – ${e.toLocaleTimeString()}`;
  } catch {
    return null;
  }
}

/**
 * Returns a detached HTMLElement you can pass to maplibre Popup#setDOMContent.
 * Keeps user-provided values safe by using textContent.
 */
export function createPinPopupContent(pin: PinData): HTMLElement {
  const root = document.createElement("div");
  root.style.maxWidth = "220px";
  root.style.fontSize = "12px";
  root.style.lineHeight = "1.2";

  // Title
  const name = document.createElement("div");
  name.style.fontWeight = "600";
  name.style.marginBottom = "2px";
  name.textContent = pin.vendorName;
  root.appendChild(name);

  // Event title
  if (pin.title) {
    const t = document.createElement("div");
    t.style.marginBottom = "2px";
    t.textContent = pin.title;
    root.appendChild(t);
  }

  // Time range
  const range = fmtRange(pin.starts_at, pin.ends_at);
  if (range) {
    const r = document.createElement("div");
    r.style.color = "#555";
    r.style.marginBottom = "2px";
    r.textContent = range;
    root.appendChild(r);
  }

  // Address
  if (pin.address) {
    const a = document.createElement("div");
    a.style.color = "#555";
    a.textContent = pin.address;
    root.appendChild(a);
  }

  // Link
  const link = document.createElement("a");
  link.href = `/vendor/${pin.vendorSlug}`;
  link.textContent = "View profile";
  link.style.display = "inline-block";
  link.style.marginTop = "6px";
  link.style.textDecoration = "underline";
  root.appendChild(link);

  return root;
}
