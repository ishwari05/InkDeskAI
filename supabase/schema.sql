-- Production schema for Supabase (Postgres).
-- Mirrors lib/db.ts's SQLite schema used in local dev.
-- Run this in the Supabase SQL editor when you're ready to move off SQLite.

create table studios (
  id text primary key,
  name text not null,
  location text,
  whatsapp_number text
);

create table pricing_configs (
  studio_id text primary key references studios(id),
  base_rate_per_sq_in numeric not null,
  placement_multipliers jsonb not null,
  style_multipliers jsonb not null,
  min_price numeric not null,
  deposit_percent numeric not null,
  discount_enabled boolean not null default false,
  discount_percent numeric not null default 0,
  discount_trigger_hours numeric not null default 24
);

create table artists (
  id uuid primary key default gen_random_uuid(),
  studio_id text references studios(id),
  name text not null,
  specialties text[],
  google_calendar_id text
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  studio_id text references studios(id),
  client_phone text not null,
  client_name text,
  placement text,
  size_label text,
  style text,
  reference_note text,
  reference_image_url text,
  quoted_price_low numeric,
  quoted_price_high numeric,
  status text not null default 'in_progress'
    check (status in ('in_progress','quoted','booking_requested','confirmed','lost','handed_off')),
  follow_up_sent_at timestamptz,
  discount_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  studio_id text references studios(id),
  client_phone text not null,
  stage text not null default 'greeting',
  lead_id uuid references leads(id),
  last_message_at timestamptz not null default now(),
  unique (studio_id, client_phone)
);

create table messages (
  id bigint generated always as identity primary key,
  conversation_id uuid references conversations(id),
  role text not null check (role in ('client','bot')),
  text text not null,
  at timestamptz not null default now()
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  artist_id uuid references artists(id),
  slot_time timestamptz,
  deposit_status text default 'pending' check (deposit_status in ('pending','paid','refunded')),
  razorpay_payment_id text
);

-- Row Level Security: each studio should only see its own data once you
-- have multiple studio accounts with their own dashboard logins.
alter table leads enable row level security;
alter table conversations enable row level security;
alter table bookings enable row level security;
-- Add policies here once you wire up Supabase Auth per studio owner, e.g.:
-- create policy "studio can view own leads" on leads
--   for select using (studio_id = auth.jwt() ->> 'studio_id');
