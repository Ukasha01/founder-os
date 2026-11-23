-- Maps a Founder OS reminder/task to the Google Calendar event that mirrors it. Written only by the server (service role);
-- the owner can read it. Rows with is_test = true are removed by the test-event cleanup.
create table if not exists public.google_calendar_links (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  source_type     text not null check (source_type in ('reminder', 'task')),
  source_id       uuid not null,
  google_event_id text not null,
  payload_hash    text,
  status          text not null default 'pending' check (status in ('pending', 'synced', 'failed', 'skipped_past', 'deleted')),
  attempts        integer not null default 0,
  last_error      text,
  is_test         boolean not null default false,
  synced_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source_type, source_id)
);
create index if not exists google_calendar_links_owner on public.google_calendar_links (owner_id, status);
alter table public.google_calendar_links enable row level security;
create policy google_links_select_own on public.google_calendar_links for select using (owner_id = auth.uid());
