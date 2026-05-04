import { clamp, normalizeBbox, getTimeWindowSQL } from "@/lib/geo";

describe("clamp", () => {
  it("returns the value when it is within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("returns min when value is below min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("returns max when value is above max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("returns min when value equals min", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it("returns max when value equals max", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("handles negative ranges", () => {
    expect(clamp(-200, -180, 180)).toBe(-180);
    expect(clamp(200, -180, 180)).toBe(180);
    expect(clamp(0, -180, 180)).toBe(0);
  });
});

describe("normalizeBbox", () => {
  it("returns the bbox unchanged when all values are within bounds", () => {
    expect(normalizeBbox(-74, 40, -73, 41)).toEqual({
      minLng: -74,
      maxLng: -73,
      minLat: 40,
      maxLat: 41,
    });
  });

  it("clamps minLng below -180 to -180", () => {
    expect(normalizeBbox(-200, 40, -73, 41).minLng).toBe(-180);
  });

  it("clamps maxLng above 180 to 180", () => {
    expect(normalizeBbox(-74, 40, 200, 41).maxLng).toBe(180);
  });

  it("clamps minLat below -85 to -85", () => {
    expect(normalizeBbox(-74, -90, -73, 41).minLat).toBe(-85);
  });

  it("clamps maxLat above 85 to 85", () => {
    expect(normalizeBbox(-74, 40, -73, 90).maxLat).toBe(85);
  });

  it("clamps all four values simultaneously", () => {
    expect(normalizeBbox(-200, -90, 200, 90)).toEqual({
      minLng: -180,
      maxLng: 180,
      minLat: -85,
      maxLat: 85,
    });
  });
});

describe("getTimeWindowSQL", () => {
  it("returns a range overlap expression for 'now'", () => {
    const sql = getTimeWindowSQL("now");
    expect(sql).toContain("tstzrange");
    expect(sql).toContain("now()");
  });

  it("returns a date equality expression for 'today'", () => {
    const sql = getTimeWindowSQL("today");
    expect(sql).toContain("starts_at::date");
    expect(sql).toContain("now()::date");
  });

  it("returns a day-of-week expression for 'weekend'", () => {
    const sql = getTimeWindowSQL("weekend");
    expect(sql).toContain("ISODOW");
    // Saturday = 6, Sunday = 7
    expect(sql).toContain("6");
    expect(sql).toContain("7");
  });
});
