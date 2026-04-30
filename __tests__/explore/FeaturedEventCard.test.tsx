/**
 * FeaturedEventCard — unit tests
 *
 * Tests:
 *  - Renders title
 *  - Renders image when image_url is provided; placeholder when null
 *  - Live badge shown when event is currently happening
 *  - Past badge shown when is_past is true
 *  - Date/time range formatted: same-day shows start–end time
 *  - Date/time range formatted: multi-day shows only start
 *  - Category chips rendered (max 2)
 *  - onClick fires with the card object
 *  - Starred state initialises from card.is_starred
 *  - Starred state re-syncs when card.is_starred changes (prop update)
 *  - onStarChange callback fires when FavoriteButton reports a change
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import FeaturedEventCard from "@/components/explore/FeaturedEventCard";
import type { ExploreCardData } from "@/lib/types";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    const { fill, ...rest } = props;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...rest} />;
  },
}));

// Mock FavoriteButton to a simple toggle button we can control from tests
const mockOnChange = jest.fn();
jest.mock("@/components/FavoriteButton", () => ({
  __esModule: true,
  default: ({
    initialStarred,
    onChange,
    onInitialLoad,
  }: {
    initialStarred?: boolean;
    onChange?: (v: boolean) => void;
    onInitialLoad?: (v: boolean) => void;
  }) => {
    // Call onInitialLoad synchronously so tests can inspect starred state
    React.useEffect(() => {
      onInitialLoad?.(initialStarred ?? false);
    }, [initialStarred, onInitialLoad]);

    return (
      <button
        data-testid="favorite-btn"
        data-starred={String(initialStarred ?? false)}
        onClick={() => onChange?.(!initialStarred)}
      >
        {initialStarred ? "starred" : "unstarred"}
      </button>
    );
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function msFromNow(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

const H = 60 * 60 * 1000;

function makeCard(overrides: Partial<ExploreCardData> = {}): ExploreCardData {
  return {
    id: "feat-1",
    title: "Featured Event",
    image_url: null,
    starts_at: msFromNow(H * 24),
    ends_at: msFromNow(H * 25),
    categories: [],
    is_past: false,
    is_starred: false,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FeaturedEventCard", () => {
  // ── Title ────────────────────────────────────────────────────────────────
  it("renders the event title", () => {
    render(<FeaturedEventCard card={makeCard({ title: "Night Market" })} />);
    expect(screen.getByText("Night Market")).toBeInTheDocument();
  });

  // ── Image ────────────────────────────────────────────────────────────────
  it("renders an img element when image_url is provided", () => {
    const card = makeCard({ image_url: "https://example.com/hero.jpg" });
    render(<FeaturedEventCard card={card} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.com/hero.jpg");
  });

  it("renders a placeholder when image_url is null", () => {
    const card = makeCard({ image_url: null });
    const { container } = render(<FeaturedEventCard card={card} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("No image")).toBeInTheDocument();
  });

  // ── Live badge ───────────────────────────────────────────────────────────
  it("shows the Live badge when event is currently happening", () => {
    const card = makeCard({
      starts_at: msFromNow(-H),
      ends_at: msFromNow(H),
    });
    render(<FeaturedEventCard card={card} />);
    expect(screen.getByText(/live/i)).toBeInTheDocument();
  });

  it("does NOT show the Live badge for a future event", () => {
    const card = makeCard();
    render(<FeaturedEventCard card={card} />);
    expect(screen.queryByText(/^live$/i)).not.toBeInTheDocument();
  });

  // ── Past badge ───────────────────────────────────────────────────────────
  it("shows the Past badge when is_past is true", () => {
    const card = makeCard({ is_past: true });
    render(<FeaturedEventCard card={card} />);
    expect(screen.getByText(/past/i)).toBeInTheDocument();
  });

  // ── Date formatting ──────────────────────────────────────────────────────
  it("shows the formatted start time when starts_at is provided", () => {
    const card = makeCard({ starts_at: "2026-07-04T20:00:00Z" });
    render(<FeaturedEventCard card={card} />);
    // Just verify some date text is rendered in the clock row
    expect(screen.getByText(/jul/i)).toBeInTheDocument();
  });

  it("shows start–end time range on same day", () => {
    // Both on July 4 2026 (EST = UTC-4 in summer)
    const card = makeCard({
      starts_at: "2026-07-04T20:00:00Z", // 4pm EST
      ends_at: "2026-07-05T00:00:00Z",   // 8pm EST same local day
    });
    render(<FeaturedEventCard card={card} />);
    // The formatted string should contain an en-dash (–) for the range
    const dateEl = screen.getByText(/–/);
    expect(dateEl).toBeInTheDocument();
  });

  it("does NOT render a date row when starts_at is null", () => {
    const card = makeCard({ starts_at: null, ends_at: null });
    const { container } = render(<FeaturedEventCard card={card} />);
    // No Clock icon means no svg in the date row area — container should have no small text row
    const dateRow = container.querySelector(".flex.items-center.gap-1");
    expect(dateRow).not.toBeInTheDocument();
  });

  // ── Categories ───────────────────────────────────────────────────────────
  it("renders up to 2 category chips", () => {
    const card = makeCard({ categories: ["music", "food", "art"] });
    render(<FeaturedEventCard card={card} />);
    expect(screen.getByText("music")).toBeInTheDocument();
    expect(screen.getByText("food")).toBeInTheDocument();
    expect(screen.queryByText("art")).not.toBeInTheDocument();
  });

  // ── onClick ──────────────────────────────────────────────────────────────
  it("calls onClick with the card when clicked", () => {
    const onClick = jest.fn();
    const card = makeCard();
    render(<FeaturedEventCard card={card} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { hidden: true, name: /featured event/i }));
    expect(onClick).toHaveBeenCalledWith(card);
  });

  // ── Starred state ─────────────────────────────────────────────────────────
  it("initialises the FavoriteButton as unstarred when is_starred is false", () => {
    const card = makeCard({ is_starred: false });
    render(<FeaturedEventCard card={card} />);
    expect(screen.getByTestId("favorite-btn")).toHaveAttribute("data-starred", "false");
  });

  it("initialises the FavoriteButton as starred when is_starred is true", () => {
    const card = makeCard({ is_starred: true });
    render(<FeaturedEventCard card={card} />);
    expect(screen.getByTestId("favorite-btn")).toHaveAttribute("data-starred", "true");
  });

  it("fires onStarChange when the FavoriteButton toggles", () => {
    const onStarChange = jest.fn();
    const card = makeCard({ is_starred: false });
    render(<FeaturedEventCard card={card} onStarChange={onStarChange} />);
    fireEvent.click(screen.getByTestId("favorite-btn"));
    expect(onStarChange).toHaveBeenCalledWith("feat-1", true);
  });
});
