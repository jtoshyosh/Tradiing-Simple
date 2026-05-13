alter table public.weekly_reviews
  add column if not exists q_paper text not null default '';
