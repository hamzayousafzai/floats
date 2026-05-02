/**
 * BadgeRow — unit tests
 *
 * Tests:
 *  - Renders all three badge names (Favorites, Check-ins, Reminders)
 *  - Shows "Locked" tier label when current_tier is null
 *  - Shows correct tier label (Bronze / Silver / Gold / Platinum)
 *  - Progress label: shows "{progress}/{next_threshold}" text
 *  - Progress label: shows raw progress when Platinum / no next_threshold
 *  - "to Silver / to Gold / to Platinum" suffix displayed correctly
 *  - "View all badges" button is present
 *  - Clicking "View all badges" opens BadgesDetailModal
 *  - BadgesDetailModal is NOT shown by default
 *  - Handles empty badges array (all Locked)
 *  - Last badge (Reminders) displays correct display name
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import BadgeRow from "@/components/profile/BadgeRow";

// Mock BadgesDetailModal so we don't need its full dependency tree
jest.mock("@/components/profile/BadgesDetailModal", () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="badges-detail-modal">
      <button onClick={onClose}>Close modal</button>
    </div>
  ),
}));

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

const bronzeFavorites = [
  makeBadge("favorites", "star", "Bronze", 3, 5),
  makeBadge("checkins", "ticket", null, 0, 1),
  makeBadge("notifications", "bell", null, 0, 1),
];

const allPlatinum = [
  makeBadge("favorites", "star", "Platinum", 25, null),
  makeBadge("checkins", "ticket", "Platinum", 25, null),
  makeBadge("notifications", "bell", "Platinum", 25, null),
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe("BadgeRow", () => {
  // ── Badge names ───────────────────────────────────────────────────────────
  describe("Badge names", () => {
    it("renders 'Favorites' badge name", () => {
      render(<BadgeRow badges={allLocked} />);
      expect(screen.getByText("Favorites")).toBeInTheDocument();
    });

    it("renders 'Check-ins' badge name", () => {
      render(<BadgeRow badges={allLocked} />);
      expect(screen.getByText("Check-ins")).toBeInTheDocument();
    });

    it("renders 'Reminders' badge name", () => {
      render(<BadgeRow badges={allLocked} />);
      expect(screen.getByText("Reminders")).toBeInTheDocument();
    });
  });

  // ── Tier labels ───────────────────────────────────────────────────────────
  describe("Tier labels", () => {
    it("shows 'Locked' for all badges when no tier earned", () => {
      render(<BadgeRow badges={allLocked} />);
      const lockedLabels = screen.getAllByText("Locked");
      expect(lockedLabels).toHaveLength(3);
    });

    it("shows 'Bronze' tier label when badge is at Bronze", () => {
      render(<BadgeRow badges={bronzeFavorites} />);
      expect(screen.getByText("Bronze")).toBeInTheDocument();
    });

    it("shows 'Platinum' tier label for a Platinum badge", () => {
      render(<BadgeRow badges={allPlatinum} />);
      const platinumLabels = screen.getAllByText("Platinum");
      expect(platinumLabels.length).toBeGreaterThanOrEqual(1);
    });

    it("shows correct tier for Silver", () => {
      const badges = [makeBadge("favorites", "star", "Silver", 10, 15)];
      render(<BadgeRow badges={badges} />);
      expect(screen.getByText("Silver")).toBeInTheDocument();
    });

    it("shows correct tier for Gold", () => {
      const badges = [makeBadge("favorites", "star", "Gold", 16, 20)];
      render(<BadgeRow badges={badges} />);
      expect(screen.getByText("Gold")).toBeInTheDocument();
    });
  });

  // ── Progress labels ───────────────────────────────────────────────────────
  describe("Progress labels", () => {
    it("shows progress/threshold when next_threshold is set", () => {
      const badges = [makeBadge("favorites", "star", "Bronze", 3, 5)];
      render(<BadgeRow badges={badges} />);
      expect(screen.getByText(/3\/5/)).toBeInTheDocument();
    });

    it("shows raw progress without threshold when Platinum", () => {
      const badges = [makeBadge("favorites", "star", "Platinum", 25, null)];
      render(<BadgeRow badges={badges} />);
      expect(screen.getByText("25")).toBeInTheDocument();
    });

    it("shows 'to Silver' suffix for Bronze badge", () => {
      const badges = [makeBadge("favorites", "star", "Bronze", 3, 5)];
      render(<BadgeRow badges={badges} />);
      expect(screen.getByText(/to Silver/)).toBeInTheDocument();
    });

    it("shows 'to Gold' suffix for Silver badge", () => {
      const badges = [makeBadge("favorites", "star", "Silver", 8, 15)];
      render(<BadgeRow badges={badges} />);
      expect(screen.getByText(/to Gold/)).toBeInTheDocument();
    });

    it("shows 'to Platinum' suffix for Gold badge", () => {
      const badges = [makeBadge("favorites", "star", "Gold", 16, 20)];
      render(<BadgeRow badges={badges} />);
      expect(screen.getByText(/to Platinum/)).toBeInTheDocument();
    });

    it("does not show 'to X' suffix for Locked badge", () => {
      const badges = [makeBadge("favorites", "star", null, 0, 1)];
      render(<BadgeRow badges={badges} />);
      expect(screen.queryByText(/to (Bronze|Silver|Gold|Platinum)/)).not.toBeInTheDocument();
    });
  });

  // ── Section header ────────────────────────────────────────────────────────
  it("renders 'Your Progress' heading", () => {
    render(<BadgeRow badges={allLocked} />);
    expect(screen.getByText("Your Progress")).toBeInTheDocument();
  });

  // ── View all badges button ────────────────────────────────────────────────
  describe("View all badges", () => {
    it("renders the 'View all badges' button", () => {
      render(<BadgeRow badges={allLocked} />);
      expect(screen.getByText(/view all badges/i)).toBeInTheDocument();
    });

    it("modal is NOT shown by default", () => {
      render(<BadgeRow badges={allLocked} />);
      expect(screen.queryByTestId("badges-detail-modal")).not.toBeInTheDocument();
    });

    it("opens BadgesDetailModal when 'View all badges' is clicked", () => {
      render(<BadgeRow badges={allLocked} />);
      fireEvent.click(screen.getByText(/view all badges/i));
      expect(screen.getByTestId("badges-detail-modal")).toBeInTheDocument();
    });

    it("closes BadgesDetailModal when modal's onClose is called", () => {
      render(<BadgeRow badges={allLocked} />);
      fireEvent.click(screen.getByText(/view all badges/i));
      expect(screen.getByTestId("badges-detail-modal")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Close modal"));
      expect(screen.queryByTestId("badges-detail-modal")).not.toBeInTheDocument();
    });
  });

  // ── Empty badges array ────────────────────────────────────────────────────
  it("handles empty badges array without crashing (defaults to Locked)", () => {
    render(<BadgeRow badges={[]} />);
    const lockedLabels = screen.getAllByText("Locked");
    expect(lockedLabels).toHaveLength(3);
  });
});
