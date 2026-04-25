alter table if exists public.sessions
  add column if not exists higher_timeframe_context text,
  add column if not exists session_bias text,
  add column if not exists bias_confidence text,
  add column if not exists expected_market_condition text,
  add column if not exists primary_setup_focus text,
  add column if not exists sit_out_condition text,
  add column if not exists main_objective text,
  add column if not exists starting_emotional_state text,
  add column if not exists pre_session_note text,
  add column if not exists bias_correctness text,
  add column if not exists market_condition_correctness text,
  add column if not exists setup_focus_correctness text,
  add column if not exists post_session_emotion text;

alter table if exists public.attachments
  add column if not exists session_id uuid references public.sessions(id) on delete cascade;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sessions'::regclass
      and conname = 'sessions_session_type_check'
  ) then
    alter table public.sessions drop constraint sessions_session_type_check;
  end if;
end $$;

alter table if exists public.sessions
  add constraint sessions_session_type_check
  check (session_type in ('chart', 'journal', 'pre_session_plan', 'chart_session', 'post_session_review'));

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.attachments'::regclass
      and conname = 'attachments_check'
  ) then
    alter table public.attachments drop constraint attachments_check;
  end if;
end $$;

alter table if exists public.attachments
  add constraint attachments_check
  check (
    ((trade_id is not null)::int + (no_trade_day_id is not null)::int + (session_id is not null)::int) = 1
  );
