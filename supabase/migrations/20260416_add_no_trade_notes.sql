alter table if exists public.no_trade_days
  add column if not exists notes text;
