/**
 * EventCard — unit tests
 *
 * Tests the rendering logic of EventCard including:
 *  - Live badge (event is currently happening)
 *  - Urgency badge (starting within 6 hours)
 *  - Past badge (is_past flag)
 *  - No-image placeholder
 *  - Category chips (max 3 displayed)
 *  - Date/time line displayed
 *  - Address line displayed
 *  - onClick fires
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import EventCard from "@/components/explore/EventCard";
import type { ExploreCardData } from "@/lib/types";

// next/image is a server component; replace with a plain <img> in tests
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    const { fill, ...rest } = props;
    return <img {...rest} />;
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function isoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const MS = {
  hour: 60 * 60 * 1000,
  minute: 60 * 1000,
};

function makeCard(overrides: Partial<ExploreCardData> = {}): ExploreCardData {
  return {
    id: "evt-1",
    title: "Test Event",
    image_url: null,
    starts_at: isoFromNow(MS.hour * 24), // tomorrow by default
    ends_at: isoFromNow(MS.hour * 25),
    address: "123 Main St",
    categories: [],
    is_past: false,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("EventCard", () => {
  // ── Badge: Live ──────────────────────────────────────────────────────────
  describe("Live badge", () => {
    it("shows the Live badge when the event is currently happening", () => {
      const card = makeCard({
        starts_at: isoFromNow(-MS.hour),     // started 1 hour ago
        ends_at: isoFromNow(MS.hour),        // ends in 1 hour
      });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.getByText(/live/i)).toBeInTheDocument();
    });

    it("does NOT show the Live badge for a future event", () => {
      const card = makeCard();
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.queryByText(/^live$/i)).not.toBeInTheDocument();
    });

    it("does NOT show the Live badge for a past event", () => {
      const card = makeCard({
        starts_at: isoFromNow(-MS.hour * 3),
        ends_at: isoFromNow(-MS.hour * 1),
        is_past: true,
      });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.queryByText(/^live$/i)).not.toBeInTheDocument();
    });
  });

  // ── Badge: Urgency ───────────────────────────────────────────────────────
  describe("Urgency badge", () => {
    it("shows hours urgency badge when starting in ≤ 6 hours", () => {
      const card = makeCard({
        starts_at: isoFromNow(MS.hour * 3), // 3 hours away
        ends_at: isoFromNow(MS.hour * 4),
      });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.getByText(/starts in 3h/i)).toBeInTheDocument();
    });

    it("shows minutes urgency badge when starting in < 1 hour", () => {
      const card = makeCard({
        starts_at: isoFromNow(MS.minute * 30), // 30 minutes away
        ends_at: isoFromNow(MS.hour * 2),
      });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.getByText(/starts in 30m/i)).toBeInTheDocument();
    });

    it("does NOT show urgency badge when event starts in > 6 hours", () => {
      const card = makeCard({
        starts_at: isoFromNow(MS.hour * 10),
        ends_at: isoFromNow(MS.hour * 11),
      });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.queryByText(/starts in/i)).not.toBeInTheDocument();
    });

    it("does NOT show urgency badge for a live event (live takes priority)", () => {
      const card = makeCard({
        starts_at: isoFromNow(-MS.hour),
        ends_at: isoFromNow(MS.hour),
      });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.queryByText(/starts in/i)).not.toBeInTheDocument();
      expect(screen.getByText(/live/i)).toBeInTheDocument();
    });
  });

  // ── Badge: Past ──────────────────────────────────────────────────────────
  describe("Past badge", () => {
    it("shows the Past badge when is_past is true", () => {
      const card = makeCard({
        starts_at: isoFromNow(-MS.hour * 48),
        ends_at: isoFromNow(-MS.hour * 47),
        is_past: true,
      });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.getByText(/past/i)).toBeInTheDocument();
    });

    it("does NOT show the Past badge when is_past is false", () => {
      const card = makeCard({ is_past: false });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.queryByText(/^past$/i)).not.toBeInTheDocument();
    });
  });

  // ── Image ────────────────────────────────────────────────────────────────
  describe("Image / placeholder", () => {
    it("renders image when image_url is provided", () => {
      const card = makeCard({ image_url: "https://example.com/img.jpg" });
      render(<EventCard card={card} onClick={() => {}} />);
      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "https://example.com/img.jpg");
    });

    it("renders placeholder icon when image_url is null", () => {
      const card = makeCard({ image_url: null });
      const { container } = render(<EventCard card={card} onClick={() => {}} />);
      // No <img> should be present
      expect(container.querySelector("img")).not.toBeInTheDocument();
      // The svg icon from lucide is rendered inside the placeholder div
      expect(container.querySelector("svg")).toBeInTheDocument();
    });
  });

  // ── Categories ───────────────────────────────────────────────────────────
  describe("Categories", () => {
    it("renders up to 3 category chips", () => {
      const card = makeCard({ categories: ["music", "food", "art", "sports"] });
      render(<EventCard card={card} onClick={() => {}} />);
      // Only the first 3 should appear
      expect(screen.getByText("music")).toBeInTheDocument();
      expect(screen.getByText("food")).toBeInTheDocument();
      expect(screen.getByText("art")).toBeInTheDocument();
      expect(screen.queryByText("sports")).not.toBeInTheDocument();
    });

    it("renders no category chips when categories is empty", () => {
      const card = makeCard({ categories: [] });
      const { container } = render(<EventCard card={card} onClick={() => {}} />);
      // The category chip container should not exist
      const chips = container.querySelectorAll(".rounded-full.border");
      expect(chips.length).toBe(0);
    });

    it("replaces hyphens with spaces in category names", () => {
      const card = makeCard({ categories: ["live-music"] });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.getByText("live music")).toBeInTheDocument();
    });
  });

  // ── Date / Address ───────────────────────────────────────────────────────
  describe("Date and address", () => {
    it("renders address when provided", () => {
      const card = makeCard({ address: "456 Park Ave" });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.getByText("456 Park Ave")).toBeInTheDocument();
    });

    it("does NOT render address row when address is null", () => {
      const card = makeCard({ address: null });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.queryByText("null")).not.toBeInTheDocument();
    });

    it("renders a date/time when starts_at is set", () => {
      // Use a fixed ISO date so the formatted output is predictable
      const card = makeCard({ starts_at: "2026-06-15T18:00:00Z" });
      render(<EventCard card={card} onClick={() => {}} />);
      // We don't assert exact string (TZ-sensitive), just that *something* renders
      // in the time row (the Clock icon container has text next to it)
      expect(screen.getByText(/jun/i)).toBeInTheDocument();
    });

    it("does NOT render date row when starts_at is null", () => {
      const card = makeCard({ starts_at: null, address: null });
      render(<EventCard card={card} onClick={() => {}} />);
      // Without a date there should be no time text rendered
      // We verify by checking there's no element that looks like a formatted date
      expect(screen.queryByText(/·/)).not.toBeInTheDocument();
    });
  });

  // ── Interaction ──────────────────────────────────────────────────────────
  describe("Interaction", () => {
    it("calls onClick when the card is clicked", () => {
      const onClick = jest.fn();
      const card = makeCard();
      render(<EventCard card={card} onClick={onClick} />);
      fireEvent.click(screen.getByText("Test Event"));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  // ── Title ────────────────────────────────────────────────────────────────
  describe("Title", () => {
    it("renders the event title", () => {
      const card = makeCard({ title: "My Unique Event" });
      render(<EventCard card={card} onClick={() => {}} />);
      expect(screen.getByText("My Unique Event")).toBeInTheDocument();
    });
  });
});
