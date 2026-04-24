alter table public.trades
  add column if not exists is_paper_trade boolean not null default false;
