export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function normalizeBbox(minLng: number, minLat: number, maxLng: number, maxLat: number) {
  return {
    minLng: clamp(minLng, -180, 180),
    maxLng: clamp(maxLng, -180, 180),
    minLat: clamp(minLat, -85, 85),
    maxLat: clamp(maxLat, -85, 85),
  };
}

export function getTimeWindowSQL(where: "today" | "weekend" | "month") {
  switch (where) {
    case "today":
      return "e.starts_at::date = now()::date";
    case "weekend":
      return "EXTRACT(ISODOW FROM e.starts_at) IN (6,7)"; // Sat/Sun
    case "month":
      return "date_trunc('month', e.starts_at) = date_trunc('month', now())";
  }
}
