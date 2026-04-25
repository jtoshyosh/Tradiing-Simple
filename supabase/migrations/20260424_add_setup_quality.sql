alter table public.trades
  add column if not exists market_context_quality text,
  add column if not exists liquidity_structure_quality text,
  add column if not exists displacement_quality text,
  add column if not exists poi_quality text,
  add column if not exists target_room_quality text,
  add column if not exists setup_score numeric,
  add column if not exists setup_grade text,
  add column if not exists setup_auto_tags text[] not null default '{}';
