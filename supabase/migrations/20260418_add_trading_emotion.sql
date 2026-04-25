alter table public.trades
  add column if not exists trading_emotion text;

alter table public.trades
  add column if not exists trading_emotions text[] not null default '{}';

alter table public.trades
  add column if not exists entry_emotion text;

alter table public.trades
  add column if not exists in_trade_emotion text;

update public.trades
set trading_emotions = case
  when coalesce(trading_emotion, '') <> '' then array[trading_emotion]
  else '{}'
end
where coalesce(array_length(trading_emotions, 1), 0) = 0;

update public.trades
set entry_emotion = coalesce(entry_emotion, nullif(trading_emotions[1], '')),
    in_trade_emotion = coalesce(in_trade_emotion, nullif(coalesce(trading_emotions[2], trading_emotions[1]), ''))
where entry_emotion is null or in_trade_emotion is null;

alter table public.no_trade_days
  add column if not exists trading_emotion text;

alter table public.no_trade_days
  add column if not exists trading_emotions text[] not null default '{}';

alter table public.no_trade_days
  add column if not exists no_trade_mindset text;

update public.no_trade_days
set trading_emotions = case
  when coalesce(trading_emotion, '') <> '' then array[trading_emotion]
  else '{}'
end
where coalesce(array_length(trading_emotions, 1), 0) = 0;

update public.no_trade_days
set no_trade_mindset = coalesce(no_trade_mindset, nullif(trading_emotions[1], ''))
where no_trade_mindset is null;
