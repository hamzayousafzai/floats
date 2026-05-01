/**
 * ProfileStats — unit tests
 *
 * Tests:
 *  - Renders favorite count
 *  - Renders checkin count
 *  - Renders "Saved Events" label
 *  - Renders "Events Attended" label
 *  - Renders subtitle copy for each card
 *  - Counts of 0 are displayed (not hidden)
 *  - Large counts are displayed as-is
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";
import ProfileStats from "@/components/profile/ProfileStats";

// lucide-react icons render SVGs — no mock needed for these tests

describe("ProfileStats", () => {
  // ── Favorite count ────────────────────────────────────────────────────────
  describe("Favorite count", () => {
    it("renders the favoriteCount value", () => {
      render(<ProfileStats favoriteCount={9} checkinCount={0} />);
      expect(screen.getByText("9")).toBeInTheDocument();
    });

    it("renders 0 favoriteCount", () => {
      render(<ProfileStats favoriteCount={0} checkinCount={0} />);
      // Both counts are 0 — both "0"s should be in the doc
      const zeros = screen.getAllByText("0");
      expect(zeros.length).toBeGreaterThanOrEqual(1);
    });

    it("renders large favoriteCount", () => {
      render(<ProfileStats favoriteCount={1234} checkinCount={0} />);
      expect(screen.getByText("1234")).toBeInTheDocument();
    });
  });

  // ── Checkin count ─────────────────────────────────────────────────────────
  describe("Checkin count", () => {
    it("renders the checkinCount value", () => {
      render(<ProfileStats favoriteCount={0} checkinCount={7} />);
      expect(screen.getByText("7")).toBeInTheDocument();
    });

    it("renders large checkinCount", () => {
      render(<ProfileStats favoriteCount={0} checkinCount={999} />);
      expect(screen.getByText("999")).toBeInTheDocument();
    });
  });

  // ── Labels and copy ───────────────────────────────────────────────────────
  describe("Labels", () => {
    it("renders 'Saved Events' label", () => {
      render(<ProfileStats favoriteCount={5} checkinCount={2} />);
      expect(screen.getByText("Saved Events")).toBeInTheDocument();
    });

    it("renders 'Events Attended' label", () => {
      render(<ProfileStats favoriteCount={5} checkinCount={2} />);
      expect(screen.getByText("Events Attended")).toBeInTheDocument();
    });

    it("renders saved events subtitle", () => {
      render(<ProfileStats favoriteCount={5} checkinCount={2} />);
      expect(screen.getByText(/don't want to miss/i)).toBeInTheDocument();
    });

    it("renders checkin subtitle", () => {
      render(<ProfileStats favoriteCount={5} checkinCount={2} />);
      expect(screen.getByText(/thanks for showing up/i)).toBeInTheDocument();
    });
  });

  // ── Both counts visible simultaneously ───────────────────────────────────
  it("renders both counts at the same time", () => {
    render(<ProfileStats favoriteCount={3} checkinCount={8} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });
});
