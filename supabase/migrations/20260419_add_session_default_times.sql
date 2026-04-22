alter table public.user_settings
  add column if not exists chart_session_start_default time not null default '06:30';

alter table public.user_settings
  add column if not exists chart_session_end_default time not null default '09:00';

alter table public.user_settings
  add column if not exists journal_session_start_default time not null default '20:00';

alter table public.user_settings
  add column if not exists journal_session_end_default time not null default '21:00';
