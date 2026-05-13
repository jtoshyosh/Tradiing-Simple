create table if not exists public.playbook_sections (
  user_id uuid not null references auth.users(id) on delete cascade,
  section_key text not null,
  title text not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, section_key)
);

alter table public.playbook_sections enable row level security;

create policy if not exists "own playbook_sections" on public.playbook_sections
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
