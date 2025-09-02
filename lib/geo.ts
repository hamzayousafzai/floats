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

export function getTimeWindowSQL(where: "now" | "today" | "weekend") {
  switch (where) {
    case "now":
      return "tstzrange(e.starts_at, e.ends_at, '[]') @> now()";
    case "today":
      return "e.starts_at::date = now()::date";
    case "weekend":
      return "EXTRACT(ISODOW FROM e.starts_at) IN (6,7)"; // Sat/Sun
  }
}
