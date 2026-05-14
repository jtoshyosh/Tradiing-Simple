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
  unique (user_id, attachment_date)
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

alter table public.day_attachments enable row level security;
alter table public.entry_day_attachment_links enable row level security;

create policy if not exists "own day_attachments" on public.day_attachments
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy if not exists "own entry_day_attachment_links" on public.entry_day_attachment_links
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
