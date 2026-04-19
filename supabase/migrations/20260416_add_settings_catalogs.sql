alter table public.user_settings
  add column if not exists instruments text[] not null default '{"MES"}';

alter table public.user_settings
  add column if not exists mistake_catalog text[] not null default '{}';
