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

alter table public.trades
  add column if not exists market_context_quality text;

alter table public.trades
  add column if not exists liquidity_structure_quality text;

alter table public.trades
  add column if not exists displacement_quality text;

alter table public.trades
  add column if not exists poi_quality text;

alter table public.trades
  add column if not exists target_room_quality text;

alter table public.trades
  add column if not exists setup_score numeric;

alter table public.trades
  add column if not exists setup_grade text;

alter table public.trades
  add column if not exists setup_auto_tags text[] not null default '{}';

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
  session_id uuid references public.sessions(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  created_at timestamptz not null default now(),
  check (
    ((trade_id is not null)::int + (no_trade_day_id is not null)::int + (session_id is not null)::int) = 1
  )
);

alter table public.attachments
  add column if not exists session_id uuid references public.sessions(id) on delete cascade;

alter table public.attachments
  drop constraint if exists attachments_check;

alter table public.attachments
  add constraint attachments_check
  check (((trade_id is not null)::int + (no_trade_day_id is not null)::int + (session_id is not null)::int) = 1);

create table if not exists public.playbook_sections (
  user_id uuid not null references auth.users(id) on delete cascade,
  section_key text not null,
  title text not null,
  content text not null default '',
  pin_pre_session boolean not null default false,
  pin_trade_entry boolean not null default false,
  pin_review boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, section_key)
);

create table if not exists public.decision_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_intent_mode text not null check (trade_intent_mode in ('live', 'paper')),
  decision_timestamp timestamptz not null default now(),
  displacement_confirmed boolean not null default false,
  valid_poi_created boolean not null default false,
  pulling_back_not_chasing boolean not null default false,
  fib_support_quality text not null default 'yes' check (fib_support_quality in ('yes', 'no', 'na')),
  liquidity_target_clear boolean not null default false,
  stop_location_clear boolean not null default false,
  inside_session_window boolean not null default false,
  go_no_go_result text not null default 'NO_GO' check (go_no_go_result in ('GO', 'WAIT', 'NO_GO')),
  readiness_yes_count integer not null default 0,
  readiness_applicable_count integer not null default 7,
  readiness_grade text not null default 'D / Forced trade',
  execution_auto_tags text[] not null default '{}'::text[],
  hesitation_note text,
  converted_trade_id uuid references public.trades(id) on delete set null,
  skipped_setup boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.day_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attachment_date date not null,
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, attachment_date, file_path)
);

create table if not exists public.entry_day_attachment_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_attachment_id uuid not null references public.day_attachments(id) on delete cascade,
  trade_id uuid references public.trades(id) on delete cascade,
  no_trade_day_id uuid references public.no_trade_days(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete cascade,
  decision_check_id uuid references public.decision_checks(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (((trade_id is not null)::int + (no_trade_day_id is not null)::int + (session_id is not null)::int + (decision_check_id is not null)::int) = 1)
);

create unique index if not exists entry_day_attachment_links_trade_unique
  on public.entry_day_attachment_links(day_attachment_id, trade_id)
  where trade_id is not null;

create unique index if not exists entry_day_attachment_links_no_trade_unique
  on public.entry_day_attachment_links(day_attachment_id, no_trade_day_id)
  where no_trade_day_id is not null;

create unique index if not exists entry_day_attachment_links_session_unique
  on public.entry_day_attachment_links(day_attachment_id, session_id)
  where session_id is not null;

create unique index if not exists entry_day_attachment_links_decision_unique
  on public.entry_day_attachment_links(day_attachment_id, decision_check_id)
  where decision_check_id is not null;


alter table public.users enable row level security;
alter table public.trades enable row level security;
alter table public.no_trade_days enable row level security;
alter table public.weekly_reviews enable row level security;
alter table public.sessions enable row level security;
alter table public.user_settings enable row level security;
alter table public.attachments enable row level security;
alter table public.playbook_sections enable row level security;
alter table public.decision_checks enable row level security;
alter table public.day_attachments enable row level security;
alter table public.entry_day_attachment_links enable row level security;

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

create policy if not exists "own playbook_sections" on public.playbook_sections
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "own decision_checks" on public.decision_checks
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "own day_attachments" on public.day_attachments
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "own entry_day_attachment_links" on public.entry_day_attachment_links
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
