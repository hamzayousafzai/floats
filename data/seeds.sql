insert into public.vendors (slug, name, description, category, social, photo_url, geom)
values (
  'jessies-jewelry',
  'Jessie’s Jewelry',
  'Handmade gemstones and silver pieces.',
  'jewelry',
  '{"instagram":"https://instagram.com/jessiesjewelry"}',
  'https://images.unsplash.com/photo-1520975911135-3c2b6f4f3a6b?auto=format&fit=crop&w=1200&q=80',
  ST_SetSRID(ST_MakePoint(-80.8431, 35.2271), 4326)::geography
);

-- Vendor: Kevin's Vintage Shirts
insert into public.vendors (slug, name, description, category, social, photo_url, geom)
values (
  'kevins-vintage-shirts',
  'Kevin’s Vintage Shirts',
  'Curated vintage tees & retro finds.',
  'vintage',
  '{"instagram":"https://instagram.com/kevinsvintage"}',
  'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=80',
  ST_SetSRID(ST_MakePoint(-80.84, 35.23), 4326)::geography
);

-- Market: Hi-Wire Brewing (CLT)
insert into public.markets (name, description, address, geom)
values (
  'Hi-Wire Brewing Charlotte',
  'Brewery pop-up host',
  'Hi-Wire Brewing, Charlotte, NC',
  ST_SetSRID(ST_MakePoint(-80.8557, 35.2245), 4326)::geography
);

-- Link both vendors to the market directory (optional)
insert into public.market_vendors (market_id, vendor_id)
select m.id, v.id
from public.markets m, public.vendors v
where m.name = 'Hi-Wire Brewing Charlotte';

-- Events (today + upcoming)
-- Happening now for Jessie’s Jewelry
insert into public.events (vendor_id, market_id, title, status, address, geom, starts_at, ends_at)
select
  v.id, m.id, 'Pop-up: Jessie at Hi-Wire', 'confirmed', 'Hi-Wire Brewing, CLT',
  ST_SetSRID(ST_MakePoint(-80.8557, 35.2245), 4326)::geography,
  now() - interval '1 hour',
  now() + interval '3 hours'
from public.vendors v
join public.markets m on m.name = 'Hi-Wire Brewing Charlotte'
where v.slug = 'jessies-jewelry';

-- Upcoming for Kevin’s Vintage Shirts (tomorrow)
insert into public.events (vendor_id, market_id, title, status, address, geom, starts_at, ends_at)
select
  v.id, m.id, 'Pop-up: Kevin at Hi-Wire', 'scheduled', 'Hi-Wire Brewing, CLT',
  ST_SetSRID(ST_MakePoint(-80.8557, 35.2245), 4326)::geography,
  (date_trunc('day', now()) + interval '1 day') + time '12:00',
  (date_trunc('day', now()) + interval '1 day') + time '18:00'
from public.vendors v
join public.markets m on m.name = 'Hi-Wire Brewing Charlotte'
where v.slug = 'kevins-vintage-shirts';

-- ---------------------------------
-- NEW VENDOR & EVENT SEED DATA
-- ---------------------------------

-- Vendor 1: Taco Truck Terry (Food)
insert into public.vendors (slug, name, description, category, photo_url, geom)
values (
  'taco-truck-terry',
  'Taco Truck Terry',
  'Authentic street tacos with a modern twist. Carne asada is a must-try!',
  'Food',
  'https://images.unsplash.com/photo-1599974538138-98a3b3a34d63?auto=format&fit=crop&w=1200&q=80',
  ST_SetSRID(ST_MakePoint(-80.835, 35.214), 4326)::geography
);

-- Vendor 2: Crafty Carol (Crafts)
insert into public.vendors (slug, name, description, category, photo_url, geom)
values (
  'crafty-carol',
  'Crafty Carol''s Creations',
  'Handmade pottery, macrame, and unique home decor items.',
  'Crafts',
  'https://images.unsplash.com/photo-1569144157591-c60f3f633da7?auto=format&fit=crop&w=1200&q=80',
  ST_SetSRID(ST_MakePoint(-80.851, 35.225), 4326)::geography
);

-- Vendor 3: Pete's Plant Palace (Plants)
insert into public.vendors (slug, name, description, category, photo_url, geom)
values (
  'petes-plant-palace',
  'Pete''s Plant Palace',
  'Rare and common houseplants for every level of plant parent.',
  'Plants',
  'https://images.unsplash.com/photo-1587329264479-e72093995479?auto=format&fit=crop&w=1200&q=80',
  ST_SetSRID(ST_MakePoint(-80.848, 35.235), 4326)::geography
);

-- Vendor 4: Retro Game Resellers (Games)
insert into public.vendors (slug, name, description, category, photo_url, geom)
values (
  'retro-game-resellers',
  'Retro Game Resellers',
  'Buy, sell, and trade classic video games and consoles from the 80s, 90s, and 2000s.',
  'Games',
  'https://images.unsplash.com/photo-1612036782180-6f0b6cd84627?auto=format&fit=crop&w=1200&q=80',
  ST_SetSRID(ST_MakePoint(-80.830, 35.220), 4326)::geography
);

-- Vendor 5: Bella's Baked Goods (Food)
insert into public.vendors (slug, name, description, category, photo_url, geom)
values (
  'bellas-baked-goods',
  'Bella''s Baked Goods',
  'Artisanal breads, pastries, and custom cakes made with locally-sourced ingredients.',
  'Food',
  'https://images.unsplash.com/photo-1588195538326-c5b1e9f80a1b?auto=format&fit=crop&w=1200&q=80',
  ST_SetSRID(ST_MakePoint(-80.841, 35.219), 4326)::geography
);


-- ---------------------------------
-- NEW EVENTS
-- ---------------------------------

-- Event 1 (TODAY): Taco Truck Terry
insert into public.events (vendor_id, title, status, address, geom, starts_at, ends_at)
select
  v.id, 'Taco Tuesday Pop-up', 'confirmed', '123 Main St, Charlotte, NC',
  ST_SetSRID(ST_MakePoint(-80.835, 35.214), 4326)::geography,
  now() - interval '2 hours',
  now() + interval '2 hours'
from public.vendors v where v.slug = 'taco-truck-terry';

-- Event 2 (TODAY): Crafty Carol
insert into public.events (vendor_id, title, status, address, geom, starts_at, ends_at)
select
  v.id, 'Afternoon Craft Market', 'confirmed', 'Uptown Farmers Market',
  ST_SetSRID(ST_MakePoint(-80.851, 35.225), 4326)::geography,
  now(),
  now() + interval '4 hours'
from public.vendors v where v.slug = 'crafty-carol';

-- Event 3 (WEEKEND): Pete's Plant Palace
-- This logic finds the upcoming Saturday.
insert into public.events (vendor_id, title, status, address, geom, starts_at, ends_at)
select
  v.id, 'Weekend Plant Sale', 'scheduled', 'South End Rail Trail',
  ST_SetSRID(ST_MakePoint(-80.848, 35.235), 4326)::geography,
  date_trunc('day', now()) + '10:00'::time + ( (13 - extract(isodow from now()))::int % 7 || ' days')::interval,
  date_trunc('day', now()) + '16:00'::time + ( (13 - extract(isodow from now()))::int % 7 || ' days')::interval
from public.vendors v where v.slug = 'petes-plant-palace';

-- Event 4 (NEXT WEEK): Retro Game Resellers
insert into public.events (vendor_id, title, status, address, geom, starts_at, ends_at)
select
  v.id, 'Gaming Swap Meet', 'scheduled', 'Convention Center Hall B',
  ST_SetSRID(ST_MakePoint(-80.830, 35.220), 4326)::geography,
  now() + interval '8 days',
  now() + interval '8 days 6 hours'
from public.vendors v where v.slug = 'retro-game-resellers';