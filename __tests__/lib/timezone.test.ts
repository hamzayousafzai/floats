import { convertToUTC } from "@/lib/timezone";

describe("convertToUTC", () => {
  describe("null / undefined passthrough", () => {
    it("returns null when given null", () => {
      expect(convertToUTC(null)).toBeNull();
    });

    it("returns undefined when given undefined", () => {
      expect(convertToUTC(undefined)).toBeUndefined();
    });

    it("returns undefined for an empty string", () => {
      // empty string is falsy — treated as passthrough
      expect(convertToUTC("")).toBe("");
    });
  });

  describe("already-zoned string passthrough", () => {
    it("returns a UTC ISO string (trailing Z) unchanged", () => {
      const iso = "2025-06-15T18:00:00.000Z";
      expect(convertToUTC(iso)).toBe(iso);
    });

    it("returns a positive offset string unchanged", () => {
      const offset = "2025-06-15T14:00:00+05:00";
      expect(convertToUTC(offset)).toBe(offset);
    });

    it("returns a negative offset string unchanged", () => {
      const offset = "2025-06-15T14:00:00-04:00";
      expect(convertToUTC(offset)).toBe(offset);
    });

    it("returns a compact offset (no colon) unchanged", () => {
      const offset = "2025-06-15T14:00:00-0400";
      expect(convertToUTC(offset)).toBe(offset);
    });

    it("returns a trailing 'Z' (uppercase) string unchanged", () => {
      const z = "2025-06-15T14:00:00Z";
      expect(convertToUTC(z)).toBe(z);
    });
  });

  describe("wall-clock conversion (America/New_York)", () => {
    it("converts a naive datetime string to a UTC ISO string", () => {
      // 2025-01-15T12:00 in New York (EST = UTC-5) → 2025-01-15T17:00:00.000Z
      const wallClock = "2025-01-15T12:00";
      const result = convertToUTC(wallClock);
      expect(result).toBe("2025-01-15T17:00:00.000Z");
    });

    it("accounts for DST (EDT = UTC-4)", () => {
      // 2025-06-15T12:00 in New York (EDT = UTC-4) → 2025-06-15T16:00:00.000Z
      const wallClock = "2025-06-15T12:00";
      const result = convertToUTC(wallClock);
      expect(result).toBe("2025-06-15T16:00:00.000Z");
    });

    it("returns a string ending in Z (is a valid ISO)", () => {
      const result = convertToUTC("2025-03-10T09:30");
      expect(result).toMatch(/Z$/);
    });
  });

  describe("malformed string fallback", () => {
    it("returns the original string if parsing fails", () => {
      // date-fns-tz will throw for completely invalid input → fallback returns original
      const bad = "not-a-date";
      const result = convertToUTC(bad);
      // Should return the original string rather than throw
      expect(result).toBe(bad);
    });
  });
});
