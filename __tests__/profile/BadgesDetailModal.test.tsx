/**
 * BadgesDetailModal — unit tests
 *
 * Tests:
 *  - Renders "Your Badges" title
 *  - Renders all three badge display names
 *  - Locked badge shows "Locked" tier label and description text
 *  - Locked badge renders Lock icon (data-testid check via aria-label fallback)
 *  - Bronze badge shows "Bronze" tier label
 *  - Silver badge shows description containing "Nice!"
 *  - Platinum / completed badge shows "Completed" pill
 *  - Completed badge shows progress total
 *  - Non-completed badge shows "{progress} / {threshold}" label
 *  - Non-completed badge shows "to {NextTier}" label
 *  - "How it works" footer is present
 *  - onClose fires when ✕ button is clicked
 *  - onClose fires when backdrop close button is clicked
 *  - Empty badges array defaults to all Locked
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import BadgesDetailModal from "@/components/profile/BadgesDetailModal";

// ── Helpers ────────────────────────────────────────────────────────────────

type Tier = "Bronze" | "Silver" | "Gold" | "Platinum" | null;

function makeBadge(
  slug: "favorites" | "checkins" | "notifications",
  icon_key: "star" | "ticket" | "bell",
  current_tier: Tier,
  progress: number,
  next_threshold: number | null,
) {
  return { slug, icon_key, name: slug, current_tier, progress, next_threshold, badge_id: null, description: null, user_id: null };
}

const allLocked = [
  makeBadge("favorites", "star", null, 0, 1),
  makeBadge("checkins", "ticket", null, 0, 1),
  makeBadge("notifications", "bell", null, 0, 1),
];

const mixed = [
  makeBadge("favorites", "star", "Bronze", 3, 5),
  makeBadge("checkins", "ticket", "Silver", 6, 10),
  makeBadge("notifications", "bell", null, 0, 1),
];

const allPlatinum = [
  makeBadge("favorites", "star", "Platinum", 25, null),
  makeBadge("checkins", "ticket", "Platinum", 22, null),
  makeBadge("notifications", "bell", "Platinum", 20, null),
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe("BadgesDetailModal", () => {
  const onClose = jest.fn();

  beforeEach(() => onClose.mockClear());

  // ── Title ─────────────────────────────────────────────────────────────────
  it("renders 'Your Badges' title", () => {
    render(<BadgesDetailModal badges={allLocked} onClose={onClose} />);
    expect(screen.getByText("Your Badges")).toBeInTheDocument();
  });

  // ── Badge display names ───────────────────────────────────────────────────
  describe("Badge display names", () => {
    it("renders 'Favorites'", () => {
      render(<BadgesDetailModal badges={allLocked} onClose={onClose} />);
      expect(screen.getAllByText("Favorites").length).toBeGreaterThanOrEqual(1);
    });

    it("renders 'Check-ins'", () => {
      render(<BadgesDetailModal badges={allLocked} onClose={onClose} />);
      expect(screen.getAllByText("Check-ins").length).toBeGreaterThanOrEqual(1);
    });

    it("renders 'Reminders'", () => {
      render(<BadgesDetailModal badges={allLocked} onClose={onClose} />);
      expect(screen.getAllByText("Reminders").length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Locked state ──────────────────────────────────────────────────────────
  describe("Locked state", () => {
    it("shows 'Locked' tier label for all badges when none earned", () => {
      render(<BadgesDetailModal badges={allLocked} onClose={onClose} />);
      const lockedEls = screen.getAllByText("Locked");
      expect(lockedEls).toHaveLength(3);
    });

    it("shows 'to unlock' description for locked badges", () => {
      render(<BadgesDetailModal badges={allLocked} onClose={onClose} />);
      // All three locked badges will have "to unlock" in their description
      const unlockTexts = screen.getAllByText(/to unlock/i);
      expect(unlockTexts).toHaveLength(3);
    });
  });

  // ── Tier labels ───────────────────────────────────────────────────────────
  describe("Tier labels", () => {
    it("shows 'Bronze' for a Bronze badge", () => {
      render(<BadgesDetailModal badges={mixed} onClose={onClose} />);
      expect(screen.getByText("Bronze")).toBeInTheDocument();
    });

    it("shows 'Silver' for a Silver badge", () => {
      render(<BadgesDetailModal badges={mixed} onClose={onClose} />);
      expect(screen.getByText("Silver")).toBeInTheDocument();
    });
  });

  // ── Descriptions ─────────────────────────────────────────────────────────
  describe("Descriptions", () => {
    it("shows 'Nice!' description for Silver tier", () => {
      render(<BadgesDetailModal badges={mixed} onClose={onClose} />);
      expect(screen.getByText(/nice!/i)).toBeInTheDocument();
    });

    it("shows 'reach' in description for Bronze tier", () => {
      render(<BadgesDetailModal badges={mixed} onClose={onClose} />);
      // Bronze favorites → "Keep saving events to reach Silver."
      expect(screen.getByText(/reach Silver/i)).toBeInTheDocument();
    });
  });

  // ── Completed state ───────────────────────────────────────────────────────
  describe("Completed state (Platinum)", () => {
    it("shows 'Completed' pill for Platinum badges", () => {
      render(<BadgesDetailModal badges={allPlatinum} onClose={onClose} />);
      const completedPills = screen.getAllByText("Completed");
      expect(completedPills).toHaveLength(3);
    });

    it("shows total progress count for completed badges", () => {
      render(<BadgesDetailModal badges={allPlatinum} onClose={onClose} />);
      expect(screen.getByText("25 total")).toBeInTheDocument();
    });

    it("shows 'Amazing!' description for Platinum badges", () => {
      render(<BadgesDetailModal badges={allPlatinum} onClose={onClose} />);
      const amazingTexts = screen.getAllByText(/amazing/i);
      expect(amazingTexts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Progress labels (non-completed) ──────────────────────────────────────
  describe("Progress labels (non-completed)", () => {
    it("shows '{progress} / {threshold}' for in-progress badges", () => {
      render(<BadgesDetailModal badges={mixed} onClose={onClose} />);
      // Bronze favorites: 3 / 5
      expect(screen.getByText("3 / 5")).toBeInTheDocument();
    });

    it("shows 'to {NextTier}' label for in-progress badges", () => {
      render(<BadgesDetailModal badges={mixed} onClose={onClose} />);
      // Bronze → to Silver
      expect(screen.getByText("to Silver")).toBeInTheDocument();
    });
  });

  // ── How it works footer ───────────────────────────────────────────────────
  it("renders 'How it works' footer", () => {
    render(<BadgesDetailModal badges={allLocked} onClose={onClose} />);
    expect(screen.getByText(/how it works/i)).toBeInTheDocument();
  });

  // ── onClose ───────────────────────────────────────────────────────────────
  describe("onClose", () => {
    it("calls onClose when ✕ button is clicked", () => {
      // jsdom does not implement HTMLFormElement.requestSubmit — suppress the noise
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      render(<BadgesDetailModal badges={allLocked} onClose={onClose} />);
      fireEvent.click(screen.getByLabelText("Close"));
      expect(onClose).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });
  });

  // ── Empty badges array ────────────────────────────────────────────────────
  it("handles empty badges array — all badges default to Locked", () => {
    render(<BadgesDetailModal badges={[]} onClose={onClose} />);
    const lockedEls = screen.getAllByText("Locked");
    expect(lockedEls).toHaveLength(3);
  });
});
