alter table public.trades
  add column if not exists trading_emotion text;

alter table public.trades
  add column if not exists trading_emotions text[] not null default '{}';

update public.trades
set trading_emotions = case
  when coalesce(trading_emotion, '') <> '' then array[trading_emotion]
  else '{}'
end
where coalesce(array_length(trading_emotions, 1), 0) = 0;

alter table public.no_trade_days
  add column if not exists trading_emotion text;

alter table public.no_trade_days
  add column if not exists trading_emotions text[] not null default '{}';

update public.no_trade_days
set trading_emotions = case
  when coalesce(trading_emotion, '') <> '' then array[trading_emotion]
  else '{}'
end
where coalesce(array_length(trading_emotions, 1), 0) = 0;
