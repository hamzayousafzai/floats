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