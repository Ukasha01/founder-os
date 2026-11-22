create table if not exists public.telegram_links (
  owner_id   uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  link_code  text,
  chat_id    bigint,
  created_at timestamptz not null default now(),
  linked_at  timestamptz
);
alter table public.telegram_links enable row level security;
create policy telegram_links_select_own on public.telegram_links for select using (owner_id = auth.uid());
create policy telegram_links_insert_own on public.telegram_links for insert with check (owner_id = auth.uid());
create policy telegram_links_update_own on public.telegram_links for update using (owner_id = auth.uid());
create policy telegram_links_delete_own on public.telegram_links for delete using (owner_id = auth.uid());
