alter table if exists public.playbook_sections
  add column if not exists pin_pre_session boolean not null default false,
  add column if not exists pin_review boolean not null default false;
