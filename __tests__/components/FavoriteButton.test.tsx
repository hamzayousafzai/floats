/**
 * @jest-environment jsdom
 *
 * FavoriteButton — unit tests
 *
 * FavoriteButton manages per-event saves in the `event_stars` table using
 * the Supabase browser client directly. It is distinct from the vendor-level
 * `favorites` table managed by the toggleFavorite server action.
 *
 * Mock strategy: mock @supabase/ssr so createBrowserClient returns our mock
 * instance. The real createSupabaseBrowserClient() then returns it naturally,
 * avoiding unreliable @/ alias resolution in jest.mock().
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

// ── Closure-captured mocks ─────────────────────────────────────────────────
// All identifiers start with 'mock' so babel-jest allows them inside
// jest.mock() factory closures after hoisting.

const mockPush = jest.fn<(...args: any[]) => any>();
const mockGetUser = jest.fn<(...args: any[]) => any>();
const mockMaybeSingle = jest.fn<(...args: any[]) => any>();
const mockUpsert = jest.fn<(...args: any[]) => any>();

// Delete chain models: .from().delete().eq(user_id).eq(event_id) → thenable
// mockDeleteFinal is the terminal .eq() that resolves to { error }
const mockDeleteFinal = jest.fn<(...args: any[]) => any>();
const mockDeleteFirstEq = jest.fn<(...args: any[]) => any>();

const mockQb = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  maybeSingle: mockMaybeSingle,
  upsert: mockUpsert,
  delete: jest.fn(),
};

const mockFrom = jest.fn(() => mockQb);

// The single Supabase instance returned by every createSupabaseBrowserClient() call.
const mockSupabaseInstance = {
  auth: { getUser: mockGetUser },
  from: mockFrom,
};

// ── Module mocks ───────────────────────────────────────────────────────────

// Mock @supabase/ssr so createBrowserClient returns our mock instance.
// This lets the real createSupabaseBrowserClient() run through normally
// while we control its output — avoids unreliable @/ alias mocking.
jest.mock("@supabase/ssr", () => ({
  createBrowserClient: jest.fn(() => mockSupabaseInstance),
  createServerClient: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: mockPush })),
  usePathname: jest.fn(() => "/"),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

// ── Imports ────────────────────────────────────────────────────────────────

import "@testing-library/jest-dom/jest-globals";
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import FavoriteButton from "@/components/FavoriteButton";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

// ── Helpers ────────────────────────────────────────────────────────────────

function authAs(id = "user-abc") {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
}
function noAuth() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Re-apply after clearAllMocks() resets mock implementations in Jest 30.
  jest.mocked(createBrowserClient).mockReturnValue(mockSupabaseInstance as never);
  jest.mocked(useRouter).mockReturnValue({ push: mockPush } as never);

  // Defaults: unauthenticated, no existing star, successful writes
  noAuth();
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockUpsert.mockResolvedValue({ error: null });
  mockDeleteFinal.mockResolvedValue({ error: null });
  mockDeleteFirstEq.mockReturnValue({ eq: mockDeleteFinal });

  // Restore chainable query builder
  mockQb.select.mockReturnValue(mockQb);
  mockQb.eq.mockReturnValue(mockQb);
  mockQb.delete.mockReturnValue({ eq: mockDeleteFirstEq });
  mockFrom.mockReturnValue(mockQb);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("FavoriteButton", () => {
  // ── Initial render with initialStarred prop ──────────────────────────────
  describe("initial render — initialStarred prop", () => {
    it("renders aria-pressed=false when initialStarred=false", () => {
      render(<FavoriteButton eventId="e1" initialStarred={false} />);
      expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    });

    it("renders aria-pressed=true when initialStarred=true", () => {
      render(<FavoriteButton eventId="e1" initialStarred={true} />);
      expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    });

    it("skips the DB fetch when initialStarred is provided", () => {
      render(<FavoriteButton eventId="e1" initialStarred={false} />);
      // No from() calls — the DB read is bypassed
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ── Initial DB fetch (no initialStarred) ─────────────────────────────────
  describe("initial render — DB fetch when initialStarred is omitted", () => {
    it("queries event_stars and reflects an existing star", async () => {
      authAs("user-1");
      mockMaybeSingle.mockResolvedValue({ data: { event_id: "e1" }, error: null });
      await act(async () => {
        render(<FavoriteButton eventId="e1" />);
      });
      await waitFor(() => {
        expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
      });
    });

    it("fires onInitialLoad with the fetched value", async () => {
      authAs("user-1");
      mockMaybeSingle.mockResolvedValue({ data: { event_id: "e1" }, error: null });
      const onInitialLoad = jest.fn();
      await act(async () => {
        render(<FavoriteButton eventId="e1" onInitialLoad={onInitialLoad} />);
      });
      await waitFor(() => expect(onInitialLoad).toHaveBeenCalledWith(true));
    });

    it("remains unstarred and skips the DB query when unauthenticated", async () => {
      noAuth();
      await act(async () => {
        render(<FavoriteButton eventId="e1" />);
      });
      expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
      // getUser was called but from() should not have been (no user → early return)
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ── disabled prop ────────────────────────────────────────────────────────
  describe("disabled prop", () => {
    it("disables the button when disabled=true", () => {
      render(<FavoriteButton eventId="e1" initialStarred={false} disabled={true} />);
      expect(screen.getByRole("button")).toBeDisabled();
    });

    it("is enabled by default", () => {
      render(<FavoriteButton eventId="e1" initialStarred={false} />);
      expect(screen.getByRole("button")).not.toBeDisabled();
    });
  });

  // ── Unauthenticated toggle ───────────────────────────────────────────────
  describe("unauthenticated toggle", () => {
    it("redirects to /login (with ?next param) when unauthenticated user clicks", async () => {
      noAuth();
      render(<FavoriteButton eventId="e1" initialStarred={false} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/login"));
      });
    });

    it("calls onAuthRedirect instead of pushing directly when provided", async () => {
      noAuth();
      const onAuthRedirect = jest.fn();
      render(<FavoriteButton eventId="e1" initialStarred={false} onAuthRedirect={onAuthRedirect} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      expect(onAuthRedirect).toHaveBeenCalledWith(expect.any(Function));
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  // ── Authenticated toggle: starring ───────────────────────────────────────
  describe("authenticated — star (unstarred → starred)", () => {
    beforeEach(() => authAs("user-abc"));

    it("optimistically sets aria-pressed=true", async () => {
      render(<FavoriteButton eventId="e1" initialStarred={false} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => {
        expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
      });
    });

    it("upserts a row into event_stars with the correct payload", async () => {
      render(<FavoriteButton eventId="e1" initialStarred={false} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
      expect(mockUpsert).toHaveBeenCalledWith(
        [expect.objectContaining({ user_id: "user-abc", event_id: "e1" })],
        expect.objectContaining({ onConflict: "user_id,event_id" }),
      );
    });

    it("fires onChange(true)", async () => {
      const onChange = jest.fn();
      render(<FavoriteButton eventId="e1" initialStarred={false} onChange={onChange} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
    });

    it("auto-follows the series when seriesId is set and event is in the future", async () => {
      const futureDate = new Date(Date.now() + 3_600_000).toISOString();
      render(
        <FavoriteButton
          eventId="e1"
          seriesId="series-1"
          startsAt={futureDate}
          initialStarred={false}
        />,
      );
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(2));
      // Second upsert is the series_follows row
      expect(mockUpsert).toHaveBeenLastCalledWith(
        [expect.objectContaining({ user_id: "user-abc", series_id: "series-1" })],
        expect.objectContaining({ onConflict: "user_id,series_id" }),
      );
    });

    it("does NOT auto-follow series when startsAt is in the past", async () => {
      const pastDate = new Date(Date.now() - 3_600_000).toISOString();
      render(
        <FavoriteButton
          eventId="e1"
          seriesId="series-1"
          startsAt={pastDate}
          initialStarred={false}
        />,
      );
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    });

    it("rolls back optimistic update on upsert error", async () => {
      mockUpsert.mockResolvedValueOnce({ error: { message: "DB error" } });
      render(<FavoriteButton eventId="e1" initialStarred={false} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => {
        expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
      });
    });
  });

  // ── Authenticated toggle: unstarring ─────────────────────────────────────
  describe("authenticated — unstar (starred → unstarred)", () => {
    beforeEach(() => authAs("user-abc"));

    it("optimistically sets aria-pressed=false", async () => {
      render(<FavoriteButton eventId="e1" initialStarred={true} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => {
        expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
      });
    });

    it("deletes the event_stars row", async () => {
      render(<FavoriteButton eventId="e1" initialStarred={true} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => expect(mockDeleteFinal).toHaveBeenCalled());
    });

    it("fires onChange(false)", async () => {
      const onChange = jest.fn();
      render(<FavoriteButton eventId="e1" initialStarred={true} onChange={onChange} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(false));
    });

    it("rolls back optimistic update on delete error", async () => {
      mockDeleteFinal.mockResolvedValueOnce({ error: { message: "Delete failed" } });
      render(<FavoriteButton eventId="e1" initialStarred={true} />);
      await act(async () => { fireEvent.click(screen.getByRole("button")); });
      await waitFor(() => {
        expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
      });
    });
  });

  // ── Pill variant ─────────────────────────────────────────────────────────
  describe("pill variant", () => {
    it("renders 'Favorite' label when unstarred", () => {
      render(<FavoriteButton eventId="e1" variant="pill" initialStarred={false} />);
      expect(screen.getByText("Favorite")).toBeInTheDocument();
    });

    it("renders 'Favorited' label when starred", () => {
      render(<FavoriteButton eventId="e1" variant="pill" initialStarred={true} />);
      expect(screen.getByText("Favorited")).toBeInTheDocument();
    });
  });
});
