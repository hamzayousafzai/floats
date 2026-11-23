-- ============================================================
-- Migration: add event_url to events
-- Date: 2026-05-01
-- Description: Adds an optional more-info URL field to events.
--   Updates active_events view and all RPCs that return event data.
-- ============================================================

-- 1. Add column to base table
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_url text;

-- 2. Recreate active_events view to include new column.
--    DROP + CREATE is required because CREATE OR REPLACE cannot reorder
--    or rename existing view columns.
DROP VIEW IF EXISTS public.active_events;

CREATE VIEW public.active_events AS
SELECT
  id,
  title,
  description,
  address,
  starts_at,
  ends_at,
  image_url,
  latitude,
  longitude,
  geom,
  status,
  is_featured,
  is_market,
  area_id,
  market_id,
  org_id,
  vendor_id,
  series_id,
  created_at,
  updated_at,
  event_url
FROM public.events
WHERE status = 'published';

-- ============================================================
-- 3. RPC PATCHES — applied in supabase/migrations/functions.sql
--
-- The following functions have been updated in functions.sql to
-- include event_url in their RETURNS TABLE and SELECT clauses:
--   • explore_events
--   • get_featured_events
--   • admin_create_events_with_series  (INSERT column + value)
--   • update_event_with_media          (UPDATE SET clause)
--   • get_user_favorites
--
-- Run functions.sql after this file to apply all RPC patches.
-- ============================================================
