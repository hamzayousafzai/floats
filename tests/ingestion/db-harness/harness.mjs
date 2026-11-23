// Substitute SQL verification environment: embedded PostgreSQL + a PostGIS shim.
// It is NOT Supabase local and NOT real PostGIS. Use it only where Docker/Supabase CLI are unavailable.
// Setup (outside the repo): mkdir <dir>; cd <dir>; npm init -y; npm install embedded-postgres pg
// Run:  $env:INGESTION_PG_TOOLS_DIR="<dir>"; node tests/ingestion/db-harness/verify-sql.mjs
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = process.env.INGESTION_PG_TOOLS_DIR;
if (!toolsDir) throw new Error("Set INGESTION_PG_TOOLS_DIR to a directory with embedded-postgres and pg installed");
const req = createRequire(path.join(toolsDir, "noop.js"));
const EmbeddedPostgres = req("embedded-postgres").default;
const pg = req("pg");

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATION_PATH = path.resolve(here, "../../../supabase/migrations/20261120000100_automated_event_ingestion.sql");

const POSTGIS_SHIM = `
create domain geography as point;
create function ST_MakePoint(double precision, double precision) returns point
  language sql immutable as $$ select pg_catalog.point($1, $2) $$;
create function ST_SetSRID(point, integer) returns point
  language sql immutable as $$ select $1 $$;
create function ST_DWithin(a geography, b geography, meters double precision)
  returns boolean language sql immutable as $$
  select 2 * 6371008.8 * pg_catalog.asin(pg_catalog.sqrt(
    pg_catalog.power(pg_catalog.sin(pg_catalog.radians(b[1] - a[1]) / 2), 2) +
    pg_catalog.cos(pg_catalog.radians(a[1])) * pg_catalog.cos(pg_catalog.radians(b[1])) *
    pg_catalog.power(pg_catalog.sin(pg_catalog.radians(b[0] - a[0]) / 2), 2)
  )) <= meters $$;
`;

export async function startServer(port = 54329) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "ingestion-pgdata-"));
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: false });
  await server.initialise();
  await server.start();
  const extDir = path.join(toolsDir, "node_modules", "@embedded-postgres", "windows-x64", "native", "share", "extension");
  writeFileSync(path.join(extDir, "postgis.control"), "comment = 'PostGIS shim for tests'\ndefault_version = '1.0'\nrelocatable = true\n");
  writeFileSync(path.join(extDir, "postgis--1.0.sql"), POSTGIS_SHIM);
  return { server, port };
}

export function connect(port, database = "postgres") {
  const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database });
  return client.connect().then(() => client);
}

export function makePool(port, database, max = 8) {
  return new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database, max });
}

/** Live-like baseline: only the objects the migration depends on (types, triggers mirror functions.sql). */
function baseSchema(postgisSchema) {
  return `
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create type public.event_status as enum ('draft','published','archived');
  create table public.categories (id uuid primary key default gen_random_uuid(), name text not null, slug text not null);
  create table public.orgs (id uuid primary key default gen_random_uuid(), name text, slug text, owner_id uuid not null);
  create table public.app_admins (user_id uuid primary key references auth.users(id) on delete cascade);
  create table public.events (
    id uuid primary key default gen_random_uuid(),
    title text, description text,
    starts_at timestamptz not null, ends_at timestamptz not null,
    address text, latitude double precision, longitude double precision,
    geom ${postgisSchema}.geography,
    event_url text, image_url text,
    is_featured boolean not null default false, is_market boolean,
    status public.event_status default 'published',
    org_id uuid references public.orgs(id), vendor_id uuid, market_id uuid, series_id uuid, area_id uuid,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.event_categories (
    event_id uuid not null references public.events(id) on delete cascade,
    category_id uuid not null references public.categories(id),
    primary key (event_id, category_id)
  );
  -- Mirrors functions.sql: unqualified PostGIS calls, no SET search_path.
  create function public.events_set_geom_from_latlon() returns trigger language plpgsql as $$
  begin
    if new.latitude is not null and new.longitude is not null then
      new.geom := ST_SetSRID(ST_MakePoint(new.longitude, new.latitude), 4326);
    else
      new.geom := null;
    end if;
    return new;
  end $$;
  create trigger events_geom_trg before insert or update on public.events
    for each row execute function public.events_set_geom_from_latlon();
  `;
}

export async function createDatabase(adminClient, name) {
  await adminClient.query(`create database ${name} template template0`);
  return name;
}

/** variant "public": postgis installed by the migration into the default schema. variant "extensions": preinstalled in extensions. */
export async function bootstrapDatabase(port, name, variant) {
  const c = await connect(port, name);
  await c.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `);
  let postgisSchema = "public";
  if (variant === "extensions") {
    await c.query(`create schema extensions; create extension postgis schema extensions;`);
    await c.query(`alter database ${name} set search_path = public, extensions`);
    await c.end();
    const c2 = await connect(port, name);
    await c2.query(baseSchema("extensions"));
    await c2.query(`grant usage on schema extensions to anon, authenticated, service_role`);
    return c2;
  }
  await c.query(`create extension postgis`);
  await c.query(baseSchema(postgisSchema));
  return c;
}

export function readMigration() {
  return readFileSync(MIGRATION_PATH, "utf8");
}

export const UPDATES_MIGRATION_PATH = path.resolve(here, "../../../supabase/migrations/20261120000200_ingestion_updates_and_review.sql");
export function readUpdatesMigration() {
  return readFileSync(UPDATES_MIGRATION_PATH, "utf8");
}

export const DELETION_POLICY_MIGRATION_PATH = path.resolve(here, "../../../supabase/migrations/20261121000100_ingestion_event_deletion_policy.sql");
export function readDeletionPolicyMigration() {
  return readFileSync(DELETION_POLICY_MIGRATION_PATH, "utf8");
}
