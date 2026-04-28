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

alter table public.decision_checks enable row level security;

create policy if not exists "own decision_checks" on public.decision_checks
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
