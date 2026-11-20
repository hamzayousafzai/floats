// Executes the migration and the publisher scenarios on the substitute PostgreSQL (see harness.mjs).
import { createHash, randomUUID } from "node:crypto";
import { startServer, connect, makePool, bootstrapDatabase, readMigration, readUpdatesMigration } from "./harness.mjs";

const results = [];
let currentVariant = "";
function check(name, ok, detail = "") {
  results.push({ variant: currentVariant, name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} [${currentVariant}] ${name}${ok ? "" : ` -> ${detail}`}`);
}
async function rejects(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return String(e.message);
  }
}

const CENTER = [35.2271, -80.8431];
const keyFor = (s) => createHash("sha256").update(s).digest("hex");
const PUBLISH = "select ingestion.publish_candidate($1::uuid, 90, $2, $3, 35, 60, $4)";
const publish = (c, id, manual = false) => c.query(PUBLISH, [id, CENTER[0], CENTER[1], manual]);

async function mkSource(c, over = {}) {
  const { rows } = await c.query(
    `insert into ingestion.sources (name, base_url, source_type, adapter, trust_state, enabled)
     values ($1, $2, 'organizer', 'html', $3, $4) returning id`,
    [over.name ?? "Test source", `https://example.org/${randomUUID()}`, over.trust ?? "trusted", over.enabled ?? true],
  );
  return rows[0].id;
}
async function mkCandidate(c, sourceId, over = {}) {
  const o = {
    title: `Market ${randomUUID().slice(0, 8)} Makers`,
    description: "A multi-vendor market featuring local makers and artists.",
    address: "123 N Tryon St, Charlotte, NC 28202",
    latitude: CENTER[0],
    longitude: CENTER[1],
    status: "ready",
    score: 95,
    duplicate_state: "clear",
    location_verified: true,
    vendor_verified: true,
    is_market: true,
    cancelled: false,
    start_offset: "3 days",
    duration: "5 hours",
    categories: ["makers"],
    approved_by: null,
    ...over,
  };
  const { rows } = await c.query(
    `insert into ingestion.candidates
       (primary_source_id, canonical_key, source_url, title, description, starts_at, ends_at, address, latitude, longitude,
        category_slugs, score, is_market, location_verified, vendor_verified, cancelled, duplicate_state, status, approved_by,
        organizer_name)
     values ($1,$2,$3,$4,$5, date_trunc('hour', now()) + $6::interval + interval '15 minutes',
             date_trunc('hour', now()) + $6::interval + interval '15 minutes' + $7::interval,
             $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, 'Example Organizer') returning id`,
    [sourceId, keyFor(randomUUID()), `https://example.org/e/${randomUUID()}`, o.title, o.description, o.start_offset, o.duration,
      o.address, o.latitude, o.longitude, o.categories, o.score, o.is_market, o.location_verified, o.vendor_verified,
      o.cancelled, o.duplicate_state, o.status, o.approved_by],
  );
  return rows[0].id;
}
async function count(c, table, where = "true") {
  return Number((await c.query(`select count(*)::int n from ${table} where ${where}`)).rows[0].n);
}

async function run(port, variant) {
  currentVariant = variant;
  const dbName = `ingest_${variant}`;
  const admin = await connect(port);
  await admin.query(`create database ${dbName} template template0`);
  await admin.end();
  const c = await bootstrapDatabase(port, dbName, variant);
  await c.query(`insert into public.categories (name, slug) values ('Makers','makers'), ('Boom','boom')`);
  const eventsColsBefore = (await c.query(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name='events' order by 1`)).rows;
  const adminUser = (await c.query(`insert into auth.users (email) values ('admin@example.org') returning id`)).rows[0].id;

  // --- TASK-04: migration, structure, grants -------------------------------------------------
  await c.query(readMigration());
  await c.query(readUpdatesMigration());
  const tables = (await c.query(`select table_name from information_schema.tables where table_schema='ingestion' order by 1`)).rows.map((r) => r.table_name);
  check("eight ingestion tables", JSON.stringify(tables) === JSON.stringify(["candidate_sources", "candidates", "observations", "publication_audit", "reviews", "runs", "source_discoveries", "sources"]), tables.join(","));
  check("public.event_ingestion_links exists", (await count(c, "information_schema.tables", "table_schema='public' and table_name='event_ingestion_links'")) === 1);
  const eventsColsAfter = (await c.query(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name='events' order by 1`)).rows;
  check("existing events columns unchanged", JSON.stringify(eventsColsBefore) === JSON.stringify(eventsColsAfter));
  const badGrants = (await c.query(
    `select grantee, table_schema, table_name, privilege_type from information_schema.role_table_grants
     where ((table_schema='ingestion') or (table_schema='public' and table_name='event_ingestion_links'))
       and grantee in ('PUBLIC','anon','authenticated')`)).rows;
  check("no anon/authenticated/PUBLIC table grants", badGrants.length === 0, JSON.stringify(badGrants));
  const svcGrants = await count(c, "information_schema.role_table_grants", `grantee='service_role' and table_schema='ingestion' and privilege_type='INSERT'`);
  check("service_role has table grants", svcGrants === 8, String(svcGrants));
  const rls = (await c.query(`select relname, relrowsecurity from pg_class where (relnamespace='ingestion'::regnamespace and relkind='r') or oid='public.event_ingestion_links'::regclass`)).rows;
  check("RLS enabled on every new table", rls.length === 9 && rls.every((r) => r.relrowsecurity), JSON.stringify(rls));
  const fn = (await c.query(`select prosecdef, proconfig from pg_proc where oid = 'ingestion.publish_candidate(uuid,integer,double precision,double precision,double precision,integer,boolean)'::regprocedure`)).rows[0];
  check("publish_candidate is SECURITY DEFINER with empty search_path", fn?.prosecdef === true && JSON.stringify(fn.proconfig) === '["search_path=\\"\\""]', JSON.stringify(fn));
  const fp = (await c.query(`select has_function_privilege('anon', f, 'execute') a, has_function_privilege('authenticated', f, 'execute') u, has_function_privilege('service_role', f, 'execute') s, has_function_privilege('public', f, 'execute') p
     from (select 'ingestion.publish_candidate(uuid,integer,double precision,double precision,double precision,integer,boolean)'::regprocedure f) q`)).rows[0];
  check("EXECUTE only for service_role", !fp.a && !fp.u && !fp.p && fp.s, JSON.stringify(fp));
  const src = await mkSource(c);
  const roleErr = await (async () => {
    await c.query("begin");
    await c.query("set local role authenticated");
    const e = await rejects(c.query("select count(*) from ingestion.sources"));
    await c.query("rollback");
    return e;
  })();
  check("authenticated cannot read ingestion tables", roleErr !== null && /permission denied/i.test(roleErr), String(roleErr));
  const linkErr = await (async () => {
    await c.query("begin");
    await c.query("set local role anon");
    const e = await rejects(c.query("select * from public.event_ingestion_links"));
    await c.query("rollback");
    return e;
  })();
  check("anon cannot read provenance", linkErr !== null && /permission denied/i.test(linkErr), String(linkErr));

  // --- TASK-05 persistence constraints (the storage layer relies on these) ----------------------
  const runId = (await c.query(`insert into ingestion.runs (run_type) values ('collection') returning id`)).rows[0].id;
  const obsSql = `insert into ingestion.observations (source_id, run_id, source_url, raw_payload, content_hash, parser_version)
                  values ($1, $2, 'https://example.org/e/dup', '{}'::jsonb, $3, '1')`;
  await c.query(obsSql, [src, runId, "b".repeat(64)]);
  const dupObs = await rejects(c.query(obsSql, [src, runId, "b".repeat(64)]));
  check("duplicate observation identity rejected (23505)", /duplicate key/.test(String(dupObs)), String(dupObs));
  const keyed = await mkCandidate(c, src, { address: "55 Unique Key Ave, Charlotte, NC 28202" });
  const dupKey = await rejects(c.query(`insert into ingestion.candidates (primary_source_id, canonical_key, source_url, title)
     select primary_source_id, canonical_key, source_url, title from ingestion.candidates where id = $1`, [keyed]));
  check("duplicate canonical_key rejected (23505)", /duplicate key/.test(String(dupKey)), String(dupKey));

  // --- TASK-15 scenarios -------------------------------------------------------------------
  // trusted live publish
  const c1 = await mkCandidate(c, src);
  const r1 = await publish(c, c1);
  const eventId = r1.rows[0].publish_candidate;
  const ev = (await c.query(`select status, is_market, org_id, vendor_id, market_id, series_id, geom is not null g, image_url from public.events where id=$1`, [eventId])).rows[0];
  check("trusted ready candidate publishes", ev?.status === "published" && ev.is_market && ev.org_id === null && ev.vendor_id === null && ev.market_id === null && ev.series_id === null && ev.image_url === null);
  check("geom populated through existing trigger despite empty search_path", ev?.g === true);
  check("provenance link and category created", (await count(c, "public.event_ingestion_links", `event_id='${eventId}' and management_state='ingestion' and organizer_display_name='Example Organizer'`)) === 1
    && (await count(c, "public.event_categories", `event_id='${eventId}'`)) === 1);
  check("candidate marked published with audit", (await count(c, "ingestion.candidates", `id='${c1}' and status='published' and published_event_id='${eventId}'`)) === 1
    && (await count(c, "ingestion.publication_audit", `candidate_id='${c1}' and action='published'`)) === 1);
  // replay
  const r1b = await publish(c, c1);
  check("replay returns same event id, no second event", r1b.rows[0].publish_candidate === eventId && (await count(c, "public.event_ingestion_links", `candidate_id='${c1}'`)) === 1);

  // gating failures
  const failing = [
    ["probation source automatic", { trustOverride: "probation" }, "Automatic publication not permitted"],
    ["disabled source", { trustOverride: "disabled" }, "Source unavailable"],
    ["status needs_review", { status: "needs_review" }, "Automatic publication not permitted"],
    ["score below minimum", { score: 80 }, "Automatic publication not permitted"],
    ["short description", { description: "too short" }, "hard publication gates"],
    ["short address", { address: "Charlotte" }, "hard publication gates"],
    ["cancelled", { cancelled: true }, "hard publication gates"],
    ["location unverified", { location_verified: false }, "hard publication gates"],
    ["vendor unverified", { vendor_verified: false }, "hard publication gates"],
    ["not a market", { is_market: false }, "hard publication gates"],
    ["possible duplicate", { duplicate_state: "possible" }, "hard publication gates"],
    ["past start", { start_offset: "-2 days" }, "hard publication gates"],
    ["beyond horizon", { start_offset: "90 days" }, "hard publication gates"],
    ["missing coordinates", { latitude: null, longitude: null }, "hard publication gates"],
    ["outside radius (Atlanta)", { latitude: 33.749, longitude: -84.388 }, "outside radius"],
  ];
  for (const [label, over, expected] of failing) {
    const trust = over.trustOverride ?? "trusted";
    const s = trust === "trusted" ? src : await mkSource(c, { trust });
    const rest = { ...over };
    delete rest.trustOverride;
    const id = await mkCandidate(c, s, { address: `${randomUUID().slice(0, 8)} Test Ave, Charlotte, NC 28202`, ...rest });
    const e = await rejects(publish(c, id));
    check(`blocked: ${label}`, e !== null && e.includes(expected), String(e));
    check(`  no event written: ${label}`, (await count(c, "public.event_ingestion_links", `candidate_id='${id}'`)) === 0);
  }
  const disabledFlag = await mkSource(c, { enabled: false });
  const idDis = await mkCandidate(c, disabledFlag, { address: "77 Elm Street, Charlotte, NC 28202" });
  check("blocked: source enabled=false", /Source unavailable/.test(String(await rejects(publish(c, idDis)))));
  check("blocked: missing candidate", /Candidate not found/.test(String(await rejects(publish(c, randomUUID())))));

  // manual path
  const probSrc = await mkSource(c, { trust: "probation" });
  const mAddr = "900 Manual Way, Charlotte, NC 28203";
  const mUnapproved = await mkCandidate(c, probSrc, { address: mAddr, status: "needs_review", score: 40 });
  check("manual path requires approval", /requires recorded admin approval/.test(String(await rejects(publish(c, mUnapproved, true)))));
  await c.query(`update ingestion.candidates set status='approved' where id=$1`, [mUnapproved]);
  check("manual path requires approver id", /requires recorded admin approval/.test(String(await rejects(publish(c, mUnapproved, true)))));
  await c.query(`update ingestion.candidates set approved_by=$2 where id=$1`, [mUnapproved, adminUser]);
  const mp = await publish(c, mUnapproved, true);
  check("approved candidate publishes from probation source (score bypass)", !!mp.rows[0].publish_candidate);
  check("manual audit reason", (await count(c, "ingestion.publication_audit", `candidate_id='${mUnapproved}' and reason='manual_approval'`)) === 1);
  const mHard = await mkCandidate(c, probSrc, { address: "901 Manual Way, Charlotte, NC 28203", status: "approved", approved_by: adminUser, cancelled: true });
  check("manual approval never bypasses hard gates", /hard publication gates/.test(String(await rejects(publish(c, mHard, true)))));

  // production duplicates
  const dupAddr = "500 Existing Blvd, Charlotte, NC 28204";
  await c.query(`insert into public.events (title, address, latitude, longitude, starts_at, ends_at, status)
                 values ('Hand Entered Festival', $1, 35.2, -80.8, date_trunc('hour', now()) + interval '10 days' + interval '15 minutes', date_trunc('hour', now()) + interval '10 days' + interval '20 hours', 'published')`, [dupAddr]);
  const dupA = await mkCandidate(c, src, { title: "Different Name Entirely", address: "500 existing blvd Charlotte NC 28204", start_offset: "10 days", duration: "2 hours" });
  check("blocked: manual production event, same address/time", /Possible existing production duplicate/.test(String(await rejects(publish(c, dupA)))));
  const dupB = await mkCandidate(c, src, { title: "hand entered festival", address: "1 Other Place, Charlotte, NC 28204", start_offset: "10 days", duration: "2 hours" });
  check("blocked: manual production event, same title/date", /Possible existing production duplicate/.test(String(await rejects(publish(c, dupB)))));
  const newDate = await mkCandidate(c, src, { title: "Hand Entered Festival", address: dupAddr, start_offset: "17 days", duration: "2 hours" });
  check("same title/address on a new weekly date is allowed", !!(await publish(c, newDate)).rows[0].publish_candidate);
  await c.query(`update public.events set status='archived' where title='Hand Entered Festival' and starts_at < now() + interval '12 days'`);
  const afterArchive = await mkCandidate(c, src, { title: "Different Name Entirely", address: dupAddr, start_offset: "10 days", duration: "2 hours" });
  check("archived production events do not block", !!(await publish(c, afterArchive)).rows[0].publish_candidate);

  // role guard
  const guardId = await mkCandidate(c, src, { address: "10 Guard Road, Charlotte, NC 28205" });
  await c.query("begin");
  await c.query(`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`);
  const guardErr = await rejects(publish(c, guardId));
  await c.query("rollback");
  check("non-service JWT role refused inside function", /Service role required/.test(String(guardErr)), String(guardErr));
  await c.query("begin");
  await c.query("set local role authenticated");
  const grantErr = await rejects(publish(c, guardId));
  await c.query("rollback");
  check("authenticated role cannot execute", grantErr !== null && /permission denied/i.test(grantErr), String(grantErr));

  // configuration rejects
  const cfgErr = await rejects(c.query(`select ingestion.publish_candidate($1::uuid, 50, 35.2, -80.8, 35, 60, false)`, [guardId]));
  check("prohibited config rejected", /Invalid publication configuration/.test(String(cfgErr)), String(cfgErr));

  // rollback on failure after the event insert
  await c.query(`create function public.boom() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$;
                 create trigger boom_trg before insert on public.event_categories for each row execute function public.boom();`);
  const rbCand = await mkCandidate(c, src, { address: "11 Rollback Lane, Charlotte, NC 28206", categories: ["makers"] });
  const eventsBefore = await count(c, "public.events");
  const rbErr = await rejects(publish(c, rbCand));
  check("failure after event insert raises", /forced failure/.test(String(rbErr)), String(rbErr));
  check("rollback leaves no event, link or audit and candidate unchanged",
    (await count(c, "public.events")) === eventsBefore
    && (await count(c, "public.event_ingestion_links", `candidate_id='${rbCand}'`)) === 0
    && (await count(c, "ingestion.publication_audit", `candidate_id='${rbCand}'`)) === 0
    && (await count(c, "ingestion.candidates", `id='${rbCand}' and status='ready' and published_event_id is null`)) === 1);
  await c.query(`drop trigger boom_trg on public.event_categories`);
  check("candidate publishes after the transient failure clears", !!(await publish(c, rbCand)).rows[0].publish_candidate);

  // fail closed when geometry trigger is missing
  await c.query(`alter table public.events disable trigger events_geom_trg`);
  const geomCand = await mkCandidate(c, src, { address: "12 Geometry Court, Charlotte, NC 28207" });
  const geomErr = await rejects(publish(c, geomCand));
  check("fails closed when geom is not populated", /geometry was not populated/.test(String(geomErr)), String(geomErr));
  check("  and rolls back", (await count(c, "public.event_ingestion_links", `candidate_id='${geomCand}'`)) === 0);
  await c.query(`alter table public.events enable trigger events_geom_trg`);

  // --- concurrency --------------------------------------------------------------------------
  const pool = makePool(port, dbName, 12);
  const raceAddr = "700 Race Street, Charlotte, NC 28202";
  const sameCand = await mkCandidate(c, src, { address: raceAddr, title: "Same Candidate Race Market", start_offset: "20 days" });
  const same = await Promise.allSettled(Array.from({ length: 6 }, () => pool.query(PUBLISH, [sameCand, CENTER[0], CENTER[1], false])));
  const okIds = new Set(same.filter((r) => r.status === "fulfilled").map((r) => r.value.rows[0].publish_candidate));
  check("same candidate in parallel: one event id for every caller", same.every((r) => r.status === "fulfilled") && okIds.size === 1, JSON.stringify(same.map((r) => r.status === "fulfilled" ? "ok" : r.reason.message)));
  check("  exactly one event/link", (await count(c, "public.event_ingestion_links", `candidate_id='${sameCand}'`)) === 1);

  for (let round = 0; round < 5; round += 1) {
    const addr = `${800 + round} Slot Drive, Charlotte, NC 28202`;
    const titles = ["Makers Market CLT", "Makers Market Charlotte", "CLT Makers Market Spring Edition", "Charlotte Artisan Market", "Makers' Market @ Slot Drive", "Slot Drive Makers Fair"];
    const ids = [];
    for (const t of titles) ids.push(await mkCandidate(c, src, { title: t, address: round % 2 === 0 ? addr : addr.toUpperCase(), start_offset: `${25 + round} days` }));
    const settled = await Promise.allSettled(ids.map((id) => pool.query(PUBLISH, [id, CENTER[0], CENTER[1], false])));
    const wins = settled.filter((r) => r.status === "fulfilled").length;
    const losses = settled.filter((r) => r.status === "rejected" && /Possible existing production duplicate/.test(r.reason.message)).length;
    const events = await count(c, "public.events", `address ilike '${800 + round} slot drive%'`);
    check(`cross-candidate race round ${round}: 1 winner, ${ids.length - 1} blocked, 1 event`, wins === 1 && losses === ids.length - 1 && events === 1, `wins=${wins} losses=${losses} events=${events} ${settled.filter((r) => r.status === "rejected").map((r) => r.reason.message).join("|")}`);
  }
  // different dates same address should not interfere with one another
  const dateIds = [];
  for (let i = 0; i < 4; i += 1) dateIds.push(await mkCandidate(c, src, { title: `Weekly Makers Market ${i}`, address: "999 Weekly Way, Charlotte, NC 28202", start_offset: `${30 + i * 7} days` }));
  const dateRes = await Promise.allSettled(dateIds.map((id) => pool.query(PUBLISH, [id, CENTER[0], CENTER[1], false])));
  check("different weekly dates at one address all publish", dateRes.every((r) => r.status === "fulfilled"), dateRes.map((r) => r.status === "rejected" ? r.reason.message : "ok").join("|"));
  await pool.end();

  await verifyImportedUpdates(c, src, port, dbName);
  await verifyReviews(c, src, port, dbName);
  await verifyRunLock(c);

  await c.end();
}

async function verifyRunLock(c) {
  const open = (type) => c.query("insert into ingestion.runs (run_type, status) values ($1, 'running') returning id", [type]);
  const first = await open("verification");
  check("run lock: second running run of the same type is refused", (await rejects(open("verification"))) !== null);
  check("run lock: a different run type may run concurrently", (await rejects(open("replay"))) === null);
  await c.query("update ingestion.runs set status = 'failed', finished_at = now() where id = $1", [first.rows[0].id]);
  check("run lock: released when the run is closed", (await rejects(open("verification"))) === null);
}

const UPDATE = "select ingestion.update_imported_event($1::uuid, $2::jsonb, $3, $4, $5, 35)";
const update = async (c, eventId, changes, evidence = null) =>
  (await c.query(UPDATE, [eventId, JSON.stringify(changes), evidence, CENTER[0], CENTER[1]])).rows[0].update_imported_event;

async function verifyImportedUpdates(c, src, port, dbName) {
  const publishNew = async (over) => {
    const id = await mkCandidate(c, src, over);
    const eventId = (await publish(c, id)).rows[0].publish_candidate;
    return { id, eventId };
  };
  const eventRow = async (eventId) => (await c.query("select * from public.events where id = $1", [eventId])).rows[0];
  const linkRow = async (eventId) => (await c.query("select * from public.event_ingestion_links where event_id = $1", [eventId])).rows[0];
  const audits = (id, action) => count(c, "ingestion.publication_audit", `candidate_id='${id}' and action='${action}'`);

  const fp = (await c.query(`select has_function_privilege('anon', f, 'execute') a, has_function_privilege('authenticated', f, 'execute') u, has_function_privilege('service_role', f, 'execute') s, has_function_privilege('public', f, 'execute') p
     from (select 'ingestion.update_imported_event(uuid,jsonb,text,double precision,double precision,double precision)'::regprocedure f) q`)).rows[0];
  check("update_imported_event EXECUTE only for service_role", !fp.a && !fp.u && !fp.p && fp.s, JSON.stringify(fp));

  // safe update of an ingestion-managed event
  const a = await publishNew({ title: "Ownership Alpha Makers Market", address: "1 Alpha Update Way, Charlotte, NC 28202", start_offset: "40 days" });
  const newTitle = "Ownership Alpha Makers Market Winter Edition";
  check("verified update applies to an ingestion-managed event", (await update(c, a.eventId, { title: newTitle, description: "Updated factual description of forty local makers." })) === "updated");
  const ev = await eventRow(a.eventId);
  check("event and candidate mirror the update", ev.title === newTitle && (await count(c, "ingestion.candidates", `id='${a.id}' and title='${newTitle}'`)) === 1);
  const upd = (await c.query("select details from ingestion.publication_audit where candidate_id=$1 and action='updated'", [a.id])).rows;
  check("update is audited with before and after", upd.length === 1 && upd[0].details.before.title !== newTitle && upd[0].details.after.title === newTitle, JSON.stringify(upd));
  check("repeating the same update is a no-op", (await update(c, a.eventId, { title: newTitle })) === "unchanged" && (await audits(a.id, "updated")) === 1);
  check("update never changes the owner/vendor relationships", (ev.org_id ?? null) === null && (ev.vendor_id ?? null) === null && (ev.series_id ?? null) === null && (ev.market_id ?? null) === null);

  // fields outside the allow-list are refused
  for (const bad of [{ status: "archived" }, { org_id: randomUUID() }, { is_featured: true }]) {
    const err = await rejects(update(c, a.eventId, bad));
    check(`unsupported field refused: ${Object.keys(bad)[0]}`, /Unsupported change field/.test(String(err)), String(err));
  }

  // hard gates are enforced on updates
  check("update with a short description is refused", (await update(c, a.eventId, { description: "too short" })) === "gates_failed");
  check("update to a past start is refused", (await update(c, a.eventId, { starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() - 80000000).toISOString() })) === "gates_failed");
  check("update outside the radius is refused", (await update(c, a.eventId, { latitude: 33.749, longitude: -84.388 })) === "outside_radius");
  const other = await publishNew({ title: "Ownership Other Craft Fair", address: "2 Other Update Way, Charlotte, NC 28202", start_offset: "41 days" });
  const otherEv = await eventRow(other.eventId);
  check("update onto another event's slot is refused", (await update(c, a.eventId, { address: otherEv.address, starts_at: otherEv.starts_at.toISOString(), ends_at: otherEv.ends_at.toISOString() })) === "possible_duplicate");
  check("refused updates left the event unchanged", (await eventRow(a.eventId)).title === newTitle);

  // management states
  const manual = await publishNew({ title: "Ownership Manual Makers Market", address: "3 Manual Update Way, Charlotte, NC 28202", start_offset: "42 days" });
  await c.query("update public.event_ingestion_links set management_state='manual' where event_id=$1", [manual.eventId]);
  check("manual-state event is never updated", (await update(c, manual.eventId, { title: "Should Not Apply Market" })) === "not_managed" && (await eventRow(manual.eventId)).title === "Ownership Manual Makers Market");
  const claimedLink = await publishNew({ title: "Ownership Claimed Makers Market", address: "4 Claimed Update Way, Charlotte, NC 28202", start_offset: "43 days" });
  await c.query("update public.event_ingestion_links set management_state='claimed' where event_id=$1", [claimedLink.eventId]);
  check("claimed-state event is never updated or archived", (await update(c, claimedLink.eventId, { title: "Should Not Apply Market" })) === "not_managed" && (await update(c, claimedLink.eventId, {}, "The organizer announced cancellation")) === "not_managed" && (await eventRow(claimedLink.eventId)).status === "published");
  const host = await publishNew({ title: "Ownership Host Makers Market", address: "5 Host Update Way, Charlotte, NC 28202", start_offset: "44 days" });
  const orgId = (await c.query("insert into public.orgs (name, slug, owner_id) values ('Host Org','host-org',$1) returning id", [randomUUID()])).rows[0].id;
  await c.query("update public.events set org_id=$1 where id=$2", [orgId, host.eventId]);
  check("host-owned event is detected, not updated, and automation disabled", (await update(c, host.eventId, { title: "Should Not Apply Market" })) === "host_owned" && (await linkRow(host.eventId)).management_state === "claimed" && (await eventRow(host.eventId)).title === "Ownership Host Makers Market");
  check("host ownership is never cleared by a later update", (await update(c, host.eventId, {})) === "not_managed" && (await eventRow(host.eventId)).org_id === orgId);
  const edited = await publishNew({ title: "Ownership Edited Makers Market", address: "6 Edited Update Way, Charlotte, NC 28202", start_offset: "45 days" });
  await c.query("update public.events set title='Hand Edited By An Admin' where id=$1", [edited.eventId]);
  check("manually edited event is detected, not overwritten, and switched to manual", (await update(c, edited.eventId, { title: "Should Not Apply Market" })) === "manually_modified" && (await linkRow(edited.eventId)).management_state === "manual" && (await eventRow(edited.eventId)).title === "Hand Edited By An Admin");

  // cancellation / archival
  const cancel = await publishNew({ title: "Ownership Cancel Makers Market", address: "7 Cancel Update Way, Charlotte, NC 28202", start_offset: "46 days" });
  const noEvidence = await rejects(update(c, cancel.eventId, {}, "short"));
  check("archival requires substantive evidence", /Cancellation evidence required/.test(String(noEvidence)), String(noEvidence));
  check("archival cannot be combined with field changes", /Invalid update request/.test(String(await rejects(update(c, cancel.eventId, { title: "Other Title Market" }, "The organizer announced cancellation")))));
  check("an event with no evidence is never archived by an ordinary update", (await update(c, cancel.eventId, {})) === "unchanged" && (await eventRow(cancel.eventId)).status === "published");
  check("verified cancellation archives the event", (await update(c, cancel.eventId, {}, "Organizer page states: this market is cancelled")) === "archived" && (await eventRow(cancel.eventId)).status === "archived");
  check("archival is audited and marks the candidate cancelled", (await audits(cancel.id, "archived")) === 1 && (await count(c, "ingestion.candidates", `id='${cancel.id}' and cancelled`)) === 1);
  check("archived event is not archived or updated again", (await update(c, cancel.eventId, {}, "Organizer page states: this market is cancelled")) === "already_archived" && (await audits(cancel.id, "archived")) === 1);

  // started events and unknown ids
  const started = await publishNew({ title: "Ownership Started Makers Market", address: "8 Started Update Way, Charlotte, NC 28202", start_offset: "47 days" });
  const pastStart = new Date(Date.now() - 3600_000).toISOString();
  const pastEnd = new Date(Date.now() + 3600_000).toISOString();
  await c.query("update public.events set starts_at = $2, ends_at = $3 where id=$1", [started.eventId, pastStart, pastEnd]);
  await c.query("update ingestion.candidates set starts_at = $2, ends_at = $3 where id=$1", [started.id, pastStart, pastEnd]);
  check("events that already started are not updated", (await update(c, started.eventId, { title: "Should Not Apply Market" })) === "event_started");
  check("unknown or non-imported event ids are ignored", (await update(c, randomUUID(), { title: "Whatever Title Here" })) === "not_imported");
  const manualEvent = (await c.query("insert into public.events (title, starts_at, ends_at, status) values ('Hand Made Event', now() + interval '50 days', now() + interval '50 days 3 hours', 'published') returning id")).rows[0].id;
  check("a manually created event without provenance is never touched", (await update(c, manualEvent, { title: "Should Not Apply Market" })) === "not_imported" && (await eventRow(manualEvent)).title === "Hand Made Event");

  // service role enforcement inside the function
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', true)");
  const roleErr = await rejects(update(c, a.eventId, { title: "Should Not Apply Market" }));
  await c.query("rollback");
  check("update refuses non-service JWT roles", /Service role required/.test(String(roleErr)), String(roleErr));

  // parallel updates to one event serialise and leave event and candidate consistent
  const racePool = makePool(port, dbName, 8);
  const race = await publishNew({ title: "Ownership Race Makers Market", address: "9 Race Update Way, Charlotte, NC 28202", start_offset: "48 days" });
  const titles = Array.from({ length: 6 }, (_, i) => `Ownership Race Makers Market Edition ${i}`);
  const settled = await Promise.allSettled(titles.map((t) => racePool.query(UPDATE, [race.eventId, JSON.stringify({ title: t }), null, CENTER[0], CENTER[1]])));
  await racePool.end();
  const finalEvent = await eventRow(race.eventId);
  const finalCand = (await c.query("select title from ingestion.candidates where id=$1", [race.id])).rows[0];
  check("parallel updates to one event all succeed and stay consistent", settled.every((r) => r.status === "fulfilled" && r.value.rows[0].update_imported_event === "updated") && titles.includes(finalEvent.title) && finalEvent.title === finalCand.title && (await linkRow(race.eventId)).management_state === "ingestion", settled.map((r) => (r.status === "rejected" ? r.reason.message : r.value.rows[0].update_imported_event)).join("|"));
}

const REVIEW = "select ingestion.apply_review($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6::timestamptz,$7::jsonb,$8) as r";

async function verifyReviews(c, src, port, dbName) {
  const adminId = (await c.query("insert into auth.users (email) values ('reviewer@example.org') returning id")).rows[0].id;
  await c.query("insert into public.app_admins (user_id) values ($1)", [adminId]);
  const plainId = (await c.query("insert into auth.users (email) values ('plain@example.org') returning id")).rows[0].id;
  const stamp = async (id) => (await c.query("select updated_at::text t from ingestion.candidates where id=$1", [id])).rows[0].t;
  const review = async (db, id, reviewer, decision, reason, { changes = {}, fields = {}, gates = true, expected } = {}) =>
    (await db.query(REVIEW, [id, reviewer, decision, reason, JSON.stringify(changes), expected ?? (await stamp(id)), JSON.stringify(fields), gates])).rows[0].r;
  const cand = (id) => c.query("select * from ingestion.candidates where id=$1", [id]).then((r) => r.rows[0]);
  const reviews = (id) => count(c, "ingestion.reviews", `candidate_id='${id}'`);

  const fp = (await c.query(`select has_function_privilege('anon', f, 'execute') a, has_function_privilege('authenticated', f, 'execute') u, has_function_privilege('service_role', f, 'execute') s, has_function_privilege('public', f, 'execute') p
     from (select 'ingestion.apply_review(uuid,uuid,text,text,jsonb,timestamptz,jsonb,boolean)'::regprocedure f) q`)).rows[0];
  check("apply_review EXECUTE only for service_role", !fp.a && !fp.u && !fp.p && fp.s, JSON.stringify(fp));

  // approval
  const a = await mkCandidate(c, src, { title: "Review Alpha Makers Market", status: "needs_review", score: 82, address: "1 Review Alpha Way, Charlotte, NC 28202", start_offset: "52 days" });
  check("approval records the real admin id and approves", (await review(c, a, adminId, "approve", "Organizer and dates verified")) === "approved");
  const ca = await cand(a);
  check("approved candidate stores approved_by and one review row", ca.status === "approved" && ca.approved_by === adminId && (await reviews(a)) === 1 && (await count(c, "ingestion.reviews", `candidate_id='${a}' and reviewer_id='${adminId}' and decision='approve'`)) === 1);
  check("approval never publishes implicitly", ca.published_event_id === null && (await count(c, "public.events", "title='Review Alpha Makers Market'")) === 0);
  check("an approved candidate can then be published manually", (await publish(c, a, true)).rows[0].publish_candidate !== null && (await count(c, "public.events", "title='Review Alpha Makers Market'")) === 1);
  check("a published candidate cannot be reviewed again", /Invalid status transition/.test(String(await rejects(review(c, a, adminId, "request_review", "Second thoughts")))));

  // authorization and validation
  const b = await mkCandidate(c, src, { title: "Review Beta Makers Market", status: "needs_review", score: 82, address: "2 Review Beta Way, Charlotte, NC 28202", start_offset: "53 days" });
  check("a non-admin reviewer is refused", /Administrator required/.test(String(await rejects(review(c, b, plainId, "approve", "Looks fine")))));
  check("a missing reviewer is refused", /Administrator required/.test(String(await rejects(review(c, b, null, "approve", "Looks fine")))));
  check("an empty reason is refused", /Invalid review request/.test(String(await rejects(review(c, b, adminId, "approve", "   ")))));
  check("an unknown decision is refused", /Invalid review request/.test(String(await rejects(review(c, b, adminId, "publish", "Because")))));
  check("an unknown candidate field is refused", /Unsupported review field/.test(String(await rejects(review(c, b, adminId, "approve", "Because", { fields: { status: "published" } })))));
  check("unresolved hard gates block approval", /Hard gates unresolved/.test(String(await rejects(review(c, b, adminId, "approve", "Because", { gates: false })))));
  check("an unverified location blocks approval", /Hard gates unresolved/.test(String(await rejects(review(c, b, adminId, "approve", "Because", { fields: { location_verified: false } })))));
  check("a possible duplicate blocks approval", /Hard gates unresolved/.test(String(await rejects(review(c, b, adminId, "approve", "Because", { fields: { duplicate_state: "possible" } })))));
  const afterBad = await cand(b);
  check("refused reviews leave the candidate and review log untouched", afterBad.status === "needs_review" && afterBad.approved_by === null && (await reviews(b)) === 0);
  check("a stale read is refused as changed", /Candidate changed/.test(String(await rejects(review(c, b, adminId, "approve", "Because", { expected: "2020-01-01 00:00:00+00" })))));
  check("an unknown candidate is refused", /Candidate not found/.test(String(await rejects(review(c, randomUUID(), adminId, "approve", "Because", { expected: "2020-01-01 00:00:00+00" })))));

  // transitions
  const ready = await mkCandidate(c, src, { title: "Review Ready Makers Market", status: "ready", address: "3 Review Ready Way, Charlotte, NC 28202", start_offset: "54 days" });
  check("a ready candidate cannot be approved or rejected directly", /Invalid status transition/.test(String(await rejects(review(c, ready, adminId, "approve", "Because")))) && /Invalid status transition/.test(String(await rejects(review(c, ready, adminId, "reject", "Because")))));
  check("request_review moves a ready candidate to needs_review", (await review(c, ready, adminId, "request_review", "Second pair of eyes")) === "needs_review" && (await reviews(ready)) === 1);

  // edits and rejection
  const edit = await review(c, b, adminId, "request_review", "Fixed the title", { changes: { title: "Review Beta Makers Market Winter" }, fields: { title: "Review Beta Makers Market Winter" } });
  const cb = await cand(b);
  check("edits are applied, recorded in the review and protect against re-scrape", edit === "needs_review" && cb.title === "Review Beta Makers Market Winter" && cb.manual_override === true && (await count(c, "ingestion.reviews", `candidate_id='${b}' and changes->>'title'='Review Beta Makers Market Winter'`)) === 1);
  check("rejection sets manual_override and cannot be reopened by approval", (await review(c, b, adminId, "reject", "Not a market")) === "rejected" && (await cand(b)).manual_override === true && /Invalid status transition/.test(String(await rejects(review(c, b, adminId, "approve", "Changed my mind")))));

  // non-service JWT role
  const j = await mkCandidate(c, src, { title: "Review Jwt Makers Market", status: "needs_review", address: "4 Review Jwt Way, Charlotte, NC 28202", start_offset: "55 days" });
  const jStamp = await stamp(j);
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', true)");
  const roleErr = await rejects(review(c, j, adminId, "approve", "Because", { expected: jStamp }));
  await c.query("rollback");
  check("apply_review refuses non-service JWT roles", /Service role required/.test(String(roleErr)), String(roleErr));

  // concurrent decisions on one candidate: exactly one wins
  const pool = makePool(port, dbName, 6);
  const r = await mkCandidate(c, src, { title: "Review Race Makers Market", status: "needs_review", address: "5 Review Race Way, Charlotte, NC 28202", start_offset: "56 days" });
  const rStamp = await stamp(r);
  const decisions = ["approve", "reject", "approve", "request_review"];
  const settled = await Promise.allSettled(decisions.map((d) => review(pool, r, adminId, d, "Racing", { expected: rStamp })));
  await pool.end();
  const wins = settled.filter((s) => s.status === "fulfilled").length;
  check("concurrent reviews of one candidate: one winner and one review row", wins === 1 && (await reviews(r)) === 1, settled.map((s) => (s.status === "rejected" ? s.reason.message : s.value)).join("|"));
}

const { server, port } = await startServer();
let failed = false;
try {
  await run(port, "public");
  await run(port, "extensions");
} catch (error) {
  failed = true;
  console.error("HARNESS ERROR:", error);
} finally {
  await server.stop();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(failed || bad.length ? 1 : 0);
