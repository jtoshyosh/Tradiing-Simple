alter table public.user_settings
  add column if not exists mistake_catalog_hidden text[] not null default '{}';
