alter table public.playbook_sections
  add column if not exists pin_trade_entry boolean not null default false;
