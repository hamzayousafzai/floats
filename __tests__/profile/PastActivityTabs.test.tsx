/**
 * PastActivityTabs — unit tests
 *
 * Tests:
 *  - Returns null when both lists are empty
 *  - Renders "Past Activity" heading when activity exists
 *  - Renders "Attended (N)" tab with correct count
 *  - Renders "Past Favorites (N)" tab with correct count
 *  - Default active tab is "Attended"
 *  - Shows attended events in default tab
 *  - Shows empty state ("No check-ins yet") when attended list is empty but past-favorites are not
 *  - Switching to "Past Favorites" tab shows those events
 *  - Shows empty state ("No past favorites") when past-favorites list is empty
 *  - "View Details" button fires onEventClick with correct event
 *  - Shows only first PAGE_SIZE (15) items when list exceeds it
 *  - "Show N more" button appears when list > 15
 *  - Clicking "Show more" reveals next batch
 *  - Attended and past-favorites paginations are independent
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import PastActivityTabs from "@/components/profile/PastActivityTabs";
import type { ExploreCardData } from "@/lib/types";

// ── Helpers ────────────────────────────────────────────────────────────────

type CheckedInCard = ExploreCardData & { checked_in_at: string };
type PastCard = ExploreCardData & { is_past?: boolean };

function makeCheckedInEvent(id: string, title: string): CheckedInCard {
  return {
    id,
    title,
    starts_at: "2024-12-01T10:00:00Z",
    ends_at: "2024-12-01T12:00:00Z",
    image_url: null,
    description: null,
    address: "123 Past St",
    latitude: null,
    longitude: null,
    categories: [],
    is_starred: false,
    is_past: true,
    series_id: null,
    event_media: null,
    checked_in_at: "2024-12-01T11:00:00Z",
  };
}

function makePastFavorite(id: string, title: string): PastCard {
  return {
    id,
    title,
    starts_at: "2024-11-01T10:00:00Z",
    ends_at: "2024-11-01T12:00:00Z",
    image_url: null,
    description: null,
    address: "456 Old Ave",
    latitude: null,
    longitude: null,
    categories: [],
    is_starred: true,
    is_past: true,
    series_id: null,
    event_media: null,
  };
}

function makeCheckedInList(count: number): CheckedInCard[] {
  return Array.from({ length: count }, (_, i) =>
    makeCheckedInEvent(`c-${i}`, `Attended Event ${i + 1}`)
  );
}

function makePastFavoriteList(count: number): PastCard[] {
  return Array.from({ length: count }, (_, i) =>
    makePastFavorite(`p-${i}`, `Past Favorite ${i + 1}`)
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("PastActivityTabs", () => {
  // ── Null render ───────────────────────────────────────────────────────────
  it("renders nothing when both lists are empty", () => {
    const { container } = render(
      <PastActivityTabs checkedInEvents={[]} pastFavorites={[]} onEventClick={jest.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders when only checkedInEvents has items", () => {
    render(
      <PastActivityTabs
        checkedInEvents={[makeCheckedInEvent("c1", "Night Market")]}
        pastFavorites={[]}
        onEventClick={jest.fn()}
      />
    );
    expect(screen.getByText("Past Activity")).toBeInTheDocument();
  });

  it("renders when only pastFavorites has items", () => {
    render(
      <PastActivityTabs
        checkedInEvents={[]}
        pastFavorites={[makePastFavorite("p1", "Old Festival")]}
        onEventClick={jest.fn()}
      />
    );
    expect(screen.getByText("Past Activity")).toBeInTheDocument();
  });

  // ── Tab counts ────────────────────────────────────────────────────────────
  describe("Tab counts", () => {
    it("shows correct Attended count in tab label", () => {
      render(
        <PastActivityTabs
          checkedInEvents={makeCheckedInList(4)}
          pastFavorites={[]}
          onEventClick={jest.fn()}
        />
      );
      expect(screen.getByText("Attended (4)")).toBeInTheDocument();
    });

    it("shows correct Past Favorites count in tab label", () => {
      render(
        <PastActivityTabs
          checkedInEvents={[]}
          pastFavorites={makePastFavoriteList(7)}
          onEventClick={jest.fn()}
        />
      );
      expect(screen.getByText("Past Favorites (7)")).toBeInTheDocument();
    });
  });

  // ── Default tab ───────────────────────────────────────────────────────────
  it("shows attended events in the default (Attended) tab", () => {
    render(
      <PastActivityTabs
        checkedInEvents={[makeCheckedInEvent("c1", "Night Market")]}
        pastFavorites={[makePastFavorite("p1", "Old Festival")]}
        onEventClick={jest.fn()}
      />
    );
    expect(screen.getByText("Night Market")).toBeInTheDocument();
    expect(screen.queryByText("Old Festival")).not.toBeInTheDocument();
  });

  // ── Empty state messages ──────────────────────────────────────────────────
  describe("Empty state messages", () => {
    it("shows 'No check-ins yet' when Attended tab is active and empty", () => {
      render(
        <PastActivityTabs
          checkedInEvents={[]}
          pastFavorites={[makePastFavorite("p1", "Old Festival")]}
          onEventClick={jest.fn()}
        />
      );
      // Default tab is Attended
      expect(screen.getByText(/no check-ins yet/i)).toBeInTheDocument();
    });

    it("shows 'No past favorites' when Past Favorites tab is active and empty", () => {
      render(
        <PastActivityTabs
          checkedInEvents={[makeCheckedInEvent("c1", "Market")]}
          pastFavorites={[]}
          onEventClick={jest.fn()}
        />
      );
      fireEvent.click(screen.getByText(/past favorites/i));
      expect(screen.getByText(/no past favorites/i)).toBeInTheDocument();
    });
  });

  // ── Tab switching ─────────────────────────────────────────────────────────
  it("switches to Past Favorites tab and shows those events", () => {
    render(
      <PastActivityTabs
        checkedInEvents={[makeCheckedInEvent("c1", "Night Market")]}
        pastFavorites={[makePastFavorite("p1", "Old Festival")]}
        onEventClick={jest.fn()}
      />
    );
    fireEvent.click(screen.getByText(/past favorites/i));
    expect(screen.getByText("Old Festival")).toBeInTheDocument();
    expect(screen.queryByText("Night Market")).not.toBeInTheDocument();
  });

  // ── onEventClick ──────────────────────────────────────────────────────────
  it("fires onEventClick with the correct event when 'View Details' is clicked", () => {
    const onEventClick = jest.fn();
    const event = makeCheckedInEvent("c1", "Market Event");
    render(
      <PastActivityTabs
        checkedInEvents={[event]}
        pastFavorites={[]}
        onEventClick={onEventClick}
      />
    );
    fireEvent.click(screen.getByText("View Details"));
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  // ── Pagination (PAGE_SIZE = 15) ───────────────────────────────────────────
  describe("Pagination", () => {
    it("shows only 15 items when list has more than 15", () => {
      render(
        <PastActivityTabs
          checkedInEvents={makeCheckedInList(20)}
          pastFavorites={[]}
          onEventClick={jest.fn()}
        />
      );
      // Items 1–15 visible; item 16 not
      expect(screen.getByText("Attended Event 15")).toBeInTheDocument();
      expect(screen.queryByText("Attended Event 16")).not.toBeInTheDocument();
    });

    it("shows 'Show N more' button when list exceeds 15", () => {
      render(
        <PastActivityTabs
          checkedInEvents={makeCheckedInList(20)}
          pastFavorites={[]}
          onEventClick={jest.fn()}
        />
      );
      expect(screen.getByText(/show \d+ more/i)).toBeInTheDocument();
    });

    it("does NOT show 'Show more' button when list has exactly 15 items", () => {
      render(
        <PastActivityTabs
          checkedInEvents={makeCheckedInList(15)}
          pastFavorites={[]}
          onEventClick={jest.fn()}
        />
      );
      expect(screen.queryByText(/show \d+ more/i)).not.toBeInTheDocument();
    });

    it("reveals more items when 'Show N more' is clicked", () => {
      render(
        <PastActivityTabs
          checkedInEvents={makeCheckedInList(20)}
          pastFavorites={[]}
          onEventClick={jest.fn()}
        />
      );
      fireEvent.click(screen.getByText(/show \d+ more/i));
      // Now all 20 should be visible
      expect(screen.getByText("Attended Event 16")).toBeInTheDocument();
      expect(screen.getByText("Attended Event 20")).toBeInTheDocument();
    });

    it("attended and past-favorites paginations are independent", () => {
      render(
        <PastActivityTabs
          checkedInEvents={makeCheckedInList(20)}
          pastFavorites={makePastFavoriteList(20)}
          onEventClick={jest.fn()}
        />
      );
      // Expand Attended
      fireEvent.click(screen.getByText(/show \d+ more/i));
      expect(screen.getByText("Attended Event 20")).toBeInTheDocument();

      // Switch to Past Favorites — still capped at 15
      fireEvent.click(screen.getByText(/past favorites/i));
      expect(screen.getByText("Past Favorite 15")).toBeInTheDocument();
      expect(screen.queryByText("Past Favorite 16")).not.toBeInTheDocument();
    });
  });
});
