-- JY Trading Journal connected schema (Supabase/Postgres)
-- Run in Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_date date not null,
  ticker text not null,
  family text not null,
  model text not null,
  classification text not null,
  pnl numeric not null default 0,
  r_multiple numeric not null default 0,
  minutes_in_trade integer not null default 0,
  emotional_pressure integer check (emotional_pressure between 1 and 5),
  trading_emotion text,
  trading_emotions text[] not null default '{}',
  entry_emotion text,
  in_trade_emotion text,
  is_paper_trade boolean not null default false,
  mistake_tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trades
  add column if not exists emotional_pressure integer;

alter table public.trades
  add column if not exists trading_emotion text;

alter table public.trades
  add column if not exists trading_emotions text[] not null default '{}';

alter table public.trades
  add column if not exists entry_emotion text;

alter table public.trades
  add column if not exists in_trade_emotion text;

alter table public.trades
  add column if not exists is_paper_trade boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trades_emotional_pressure_range'
      and conrelid = 'public.trades'::regclass
  ) then
    alter table public.trades
      add constraint trades_emotional_pressure_range
      check (emotional_pressure is null or emotional_pressure between 1 and 5);
  end if;
end $$;

create table if not exists public.no_trade_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_date date not null,
  reason text not null,
  trading_emotion text,
  trading_emotions text[] not null default '{}',
  no_trade_mindset text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, day_date)
);

alter table public.no_trade_days
  add column if not exists notes text;

alter table public.no_trade_days
  add column if not exists trading_emotion text;

alter table public.no_trade_days
  add column if not exists trading_emotions text[] not null default '{}';

alter table public.no_trade_days
  add column if not exists no_trade_mindset text;

create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_key date not null,
  q1 text not null default '',
  q2 text not null default '',
  q3 text not null default '',
  q_paper text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, week_key)
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_type text not null check (session_type in ('chart', 'journal')),
  session_date date not null,
  start_time time not null,
  end_time time not null,
  duration_minutes integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.weekly_reviews
  add column if not exists q_paper text not null default '';

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_reminder boolean not null default true,
  weekly_reminder boolean not null default true,
  default_risk numeric not null default 200,
  chart_session_start_default time not null default '06:30',
  chart_session_end_default time not null default '09:00',
  journal_session_start_default time not null default '20:00',
  journal_session_end_default time not null default '21:00',
  display_name text not null default 'JY',
  instruments text[] not null default '{"MES"}',
  mistake_catalog text[] not null default '{}',
  mistake_catalog_hidden text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.user_settings
  add column if not exists instruments text[] not null default '{"MES"}';

alter table public.user_settings
  add column if not exists chart_session_start_default time not null default '06:30';

alter table public.user_settings
  add column if not exists chart_session_end_default time not null default '09:00';

alter table public.user_settings
  add column if not exists journal_session_start_default time not null default '20:00';

alter table public.user_settings
  add column if not exists journal_session_end_default time not null default '21:00';

alter table public.user_settings
  add column if not exists mistake_catalog text[] not null default '{}';

alter table public.user_settings
  add column if not exists mistake_catalog_hidden text[] not null default '{}';

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid references public.trades(id) on delete cascade,
  no_trade_day_id uuid references public.no_trade_days(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  created_at timestamptz not null default now(),
  check (
    (trade_id is not null and no_trade_day_id is null) or
    (trade_id is null and no_trade_day_id is not null)
  )
);

alter table public.users enable row level security;
alter table public.trades enable row level security;
alter table public.no_trade_days enable row level security;
alter table public.weekly_reviews enable row level security;
alter table public.sessions enable row level security;
alter table public.user_settings enable row level security;
alter table public.attachments enable row level security;

create policy if not exists "own users" on public.users
for all using (auth.uid() = id) with check (auth.uid() = id);

create policy if not exists "own trades" on public.trades
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "own no_trade_days" on public.no_trade_days
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "own weekly_reviews" on public.weekly_reviews
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "own sessions" on public.sessions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "own user_settings" on public.user_settings
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "own attachments" on public.attachments
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage bucket for attachment uploads
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy if not exists "own storage objects" on storage.objects
for all to authenticated
using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- Future passkey prep note:
-- keep Supabase auth users as identity source; add WebAuthn/passkey credential table linked to auth.users in next milestone.
-- Migration note from local-only v0.8/v0.9:
-- 1) export localStorage keys to JSON,
-- 2) map fields to tables above,
-- 3) upload files to storage bucket and write rows in public.attachments,
-- 4) backfill weekly_reviews and user_settings.
