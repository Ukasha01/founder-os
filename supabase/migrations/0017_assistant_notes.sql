-- What the assistant has been asked to remember about the user (habits, preferences, patterns). Short, visible and deletable.
create table if not exists public.assistant_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note text not null check (length(btrim(note)) > 0 and length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists assistant_notes_owner_idx on public.assistant_notes (owner_id, created_at desc);
alter table public.assistant_notes enable row level security;
create policy assistant_notes_select_own on public.assistant_notes for select using (owner_id = auth.uid());
create policy assistant_notes_insert_own on public.assistant_notes for insert with check (owner_id = auth.uid());
create policy assistant_notes_update_own on public.assistant_notes for update using (owner_id = auth.uid());
create policy assistant_notes_delete_own on public.assistant_notes for delete using (owner_id = auth.uid());
grant select, insert, update, delete on public.assistant_notes to authenticated;
