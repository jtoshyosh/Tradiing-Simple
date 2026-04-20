-- Safe migration for emotional pressure support on public.trades
-- Keeps column nullable and constrained to valid 1-5 range when present.

alter table if exists public.trades
  add column if not exists emotional_pressure integer;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trades' and column_name = 'emotional_pressure') then
    if not exists (
      select 1 from pg_constraint
      where conname = 'trades_emotional_pressure_range'
        and conrelid = 'public.trades'::regclass
    ) then
      alter table public.trades
        add constraint trades_emotional_pressure_range
        check (emotional_pressure is null or emotional_pressure between 1 and 5);
    end if;
  end if;
end $$;
