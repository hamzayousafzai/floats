# Data Model

All types are auto-generated in `lib/database.types.ts` from the live Supabase schema. Do not edit that file manually; regenerate it with `npm run db:types`.

## Tables

### `vendors`
Core entity. Represents a vendor/brand that puts on events.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text UNIQUE | URL identifier |
| `name` | text | |
| `description` | text \| null | |
| `category` | text \| null | Free-text category (not FK to categories) |
| `photo_url` | text \| null | Supabase Storage URL |
| `social` | json \| null | Arbitrary social links blob |
| `geom` | geometry \| null | PostGIS geometry |
| `created_by` | uuid \| null | User who created the vendor |
| `created_at` / `updated_at` | timestamptz | |

---

### `events`
Core entity. A single scheduled event instance.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text \| null | |
| `description` | text \| null | |
| `address` | text \| null | |
| `starts_at` | timestamptz | |
| `ends_at` | timestamptz | |
| `image_url` | text \| null | Cover image |
| `event_url` | text \| null | External "more info" URL |
| `latitude` | float8 \| null | |
| `longitude` | float8 \| null | |
| `geom` | geometry \| null | PostGIS point |
| `status` | `event_status` enum | `published`, `draft`, `archived` |
| `is_featured` | boolean | Default false |
| `is_market` | boolean \| null | Whether this is a market event |
| `vendor_id` | uuid FK → vendors | |
| `org_id` | uuid FK → orgs | |
| `series_id` | uuid FK → series \| null | |
| `area_id` | uuid FK → areas \| null | |
| `market_id` | uuid FK → markets \| null | |
| `created_at` / `updated_at` | timestamptz | |

---

### `orgs`
A vendor organization that owns events and has members.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text UNIQUE | URL identifier used in host dashboard |
| `name` | text | |
| `owner_id` | uuid | User who owns the org |
| `archived_at` | timestamptz \| null | Soft delete |
| `created_at` / `updated_at` | timestamptz | |

---

### `org_members`
Many-to-many: users ↔ orgs with a role.

| Column | Type | Notes |
|---|---|---|
| `org_id` | uuid FK → orgs | Composite PK |
| `user_id` | uuid | Composite PK |
| `role` | `org_role` enum | |
| `created_at` / `updated_at` | timestamptz | |

`org_role` enum values: **unknown** — check `database.types.ts` for current values.

---

### `org_invites`
Pending invites to join an org.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK → orgs | |
| `inviter_id` | uuid | User who sent invite |
| `invitee_email` | text | |
| `role` | `org_role` enum | |
| `token` | text \| null | One-time URL token |
| `expires_at` | timestamptz \| null | |
| `accepted_at` | timestamptz \| null | |
| `accepted_by_user_id` | uuid \| null | |
| `revoked_at` | timestamptz \| null | |
| `created_at` | timestamptz | |

---

### `profiles`
One-to-one with Supabase Auth `auth.users`. Stores display info.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK | Maps to `auth.users.id` |
| `display_name` | text \| null | |
| `avatar_url` | text \| null | |
| `created_at` / `updated_at` | timestamptz | |

---

### `app_admins`
Allowlist for global admin access.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK | |
| `created_at` | timestamptz | |

---

### `favorites`
User ↔ vendor save (not per-event, per-vendor).

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | Composite PK |
| `vendor_id` | uuid FK → vendors | Composite PK |
| `created_at` | timestamptz | |

---

### `event_stars`
User ↔ event save (per-event, distinct from vendor favorites).

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | Composite PK |
| `event_id` | uuid FK → events | Composite PK |
| `created_at` | timestamptz \| null | |

---

### `check_ins`
Successful geo-validated check-ins.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `event_id` | uuid FK → events | |
| `lat` / `lng` | float8 | User's coordinates at check-in |
| `distance_m` | float8 | Distance from event location |
| `accuracy_m` | float8 \| null | GPS accuracy |
| `method` | text | e.g. `web` |
| `source` | text \| null | e.g. `browser_geolocation` |
| `ip` | inet | |
| `ua` | text \| null | User agent |
| `checked_at` | timestamptz | |

---

### `check_in_attempts`
All check-in attempts (success + failure) for auditing.

Similar schema to `check_ins`, plus:
| Column | Type | Notes |
|---|---|---|
| `status` | text | `success` or failure reason |
| `failure_reason` | text \| null | |

---

### `event_checkin_settings`
Per-event geofence configuration. One-to-one with events.

| Column | Type | Notes |
|---|---|---|
| `event_id` | uuid PK FK → events | |
| `radius_m` | float8 | Geofence radius in meters |
| `require_accuracy_m` | float8 | Max allowed GPS inaccuracy |
| `starts_at` / `ends_at` | timestamptz \| null | Override time window for check-in |

---

### `event_notifications`
Per-user, per-event notification subscription.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `user_id` | uuid | |
| `event_id` | uuid FK → events | |
| `notify` | boolean \| null | Whether notification is active |
| `notify_before` | interval \| null | How far in advance to notify |
| `created_at` | timestamptz \| null | |

---

### `event_notification_queue`
Work queue for outbound email notifications.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `user_id` | uuid | |
| `event_id` | uuid FK → events | |
| `subscription_id` | int FK → event_notifications \| null | |
| `notification_kind` | `notification_kind` enum | `reminder_48hr` or `reminder_starting` |
| `status` | text | `pending`, `sent`, `failed` |
| `scheduled_at` | timestamptz | When to send |
| `sent_at` | timestamptz \| null | |
| `error_message` | text \| null | |
| `created_at` / `updated_at` | timestamptz | |

---

### `badges`
Badge definitions.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `slug` | text UNIQUE | |
| `name` | text | |
| `description` | text | |
| `icon_key` | text | Key for UI icon lookup |
| `criteria_field` | text | Which stat field triggers this badge |
| `created_at` | timestamptz | |

---

### `badge_tiers`
Threshold levels for each badge (bronze/silver/gold etc).

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `badge_id` | int FK → badges | |
| `tier` | text | e.g. `bronze`, `silver`, `gold` |
| `threshold_value` | int | Stat value required to reach this tier |

---

### `user_badges`
Earned badges per user.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | Composite PK |
| `badge_id` | int FK → badges | Composite PK |
| `highest_tier` | text | |
| `earned_at` | timestamptz | |

---

### `series`
A recurring event series (e.g. "Weekly Market").

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | |
| `org_id` | uuid FK → orgs \| null | |
| `canonical_slug` | text \| null | |
| `notes` | text \| null | |
| `created_at` | timestamptz \| null | |

---

### `series_follows`
User subscriptions to event series.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | Composite PK |
| `series_id` | uuid FK → series | Composite PK |
| `following` | boolean | Default true |
| `created_at` | timestamptz \| null | |

---

### `areas`
Geographic areas used for filtering (e.g. "Downtown").

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text UNIQUE | |
| `name` | text | |
| `geom` | geometry | PostGIS polygon |
| `is_active` | boolean | |

---

### `categories`
Event/vendor categories (e.g. "Food", "Art").

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text UNIQUE | |
| `name` | text | |

---

### `event_categories`
Junction: events ↔ categories (many-to-many).

| Column | Type | Notes |
|---|---|---|
| `event_id` | uuid FK → events | Composite PK |
| `category_id` | uuid FK → categories | Composite PK |

---

### `markets`
A physical market venue.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | |
| `address` | text \| null | |
| `description` | text \| null | |
| `geom` | geometry | |
| `map_layout_url` | text \| null | |
| `created_at` / `updated_at` | timestamptz | |

---

### `market_vendors`
Junction: markets ↔ vendors.

| Column | Type | Notes |
|---|---|---|
| `market_id` | uuid FK → markets | Composite PK |
| `vendor_id` | uuid FK → vendors | Composite PK |
| `created_at` | timestamptz | |

---

### `event_media`
Additional images for an event (gallery).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `event_id` | uuid FK → events | |
| `image_url` | text | Supabase Storage URL |
| `sort_index` | int | Display order |
| `created_at` | timestamptz | |

---

### `event_org_transfers`
Audit log of event ownership transfers between orgs.

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `event_id` | uuid FK → events | |
| `from_org_id` | uuid FK → orgs \| null | |
| `to_org_id` | uuid FK → orgs \| null | |
| `changed_by` | uuid \| null | |
| `changed_at` | timestamptz | |

---

### `user_notification_settings`
Per-user global notification preferences.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK | |
| `notify_vendor_new_events` | boolean \| null | |
| `notify_starred_changes` | boolean \| null | |
| `notify_series_future_dates` | boolean \| null | |
| `updated_at` | timestamptz \| null | |

---

### `spatial_ref_sys`
PostGIS system table. Do not modify.

---

## Views

| View | Purpose |
|---|---|
| `active_events` | Subset of `events` where `status = 'published'` |
| `event_checkin_stats` | Aggregated check-in counts per event |
| `next_event_per_vendor` | One row per vendor: their next upcoming event |
| `org_member_details` | Joins `org_members` → `profiles` + email |
| `user_org_roles` | Joins `org_members` → `orgs`; used by HostContext |
| `v_user_badges` | Badge progress per user (current tier, progress toward next) |
| `v_user_stats` | Aggregated stats per user (check-ins, favorites, notifications) |

---

## Key RPCs (PostgreSQL Functions)

| Function | Used by | Purpose |
|---|---|---|
| `explore_events(p_search_text, p_area_slugs, p_category_slugs, p_when, p_tz)` | Explore page | Filtered event list with media + categories |
| `get_featured_events(p_when, p_tz)` | Explore page | Featured event carousel |
| `check_in_event(p_event_id, p_lat, p_lng, p_accuracy_m, p_method, p_source, p_ua)` | `/api/check-in` POST | Validates + records check-in |
| `get_pending_notification_jobs(p_limit)` | Cron handler | Returns unsent queue rows |
| `accept_invites()` | HostContext | Auto-accepts pending invites for logged-in user |
| `admin_create_events_with_series(...)` | Admin event form | Creates event + optional series atomically |
| `update_event_with_media(...)` | Admin edit form | Updates event + replaces media rows |
| `get_user_favorites(p_user_id)` | Profile page | Returns starred events for a user |
| `get_time_filter_range(p_when, p_tz)` | Internal | Converts filter string to timestamptz range |

---

## Enums

| Enum | Values |
|---|---|
| `event_status` | `published`, `draft`, `archived` |
| `notification_kind` | `reminder_48hr`, `reminder_starting` |
| `org_role` | _unknown — see `database.types.ts`_ |

---

## Image Storage

Supabase Storage bucket: `event-images`  
Images are uploaded via `POST /api/upload` using the service role client.  
Public URLs are served from: `https://inxlsvowzpqvfulhbnou.supabase.co/storage/v1/object/public/`
