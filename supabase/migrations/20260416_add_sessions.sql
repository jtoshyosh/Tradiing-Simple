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

alter table public.sessions enable row level security;

create policy if not exists "own sessions" on public.sessions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
