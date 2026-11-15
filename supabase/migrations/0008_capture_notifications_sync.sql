-- 0008_capture_notifications_sync.sql
-- Quick Capture / Inbox, reminders, notifications, push subscriptions, sync ledger.

create table public.quick_capture (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  capture_type       public.capture_type not null default 'general',
  raw_text           text not null check (length(btrim(raw_text)) > 0),
  status             public.capture_status not null default 'inbox',
  -- Everything below is optional so a capture can be saved instantly and triaged later.
  workspace_id       uuid,
  priority           public.task_priority,
  due_date           date,
  parent_task_id     uuid,
  meeting_id         uuid,
  person_id          uuid,
  -- Where it ended up after triage (history only; no FK because the target type varies).
  converted_entity_type text check (converted_entity_type in ('task', 'meeting', 'commitment', 'reminder', 'kpi_entry')),
  converted_entity_id   uuid,
  source             text not null default 'typed' check (source in ('typed', 'voice', 'ai', 'offline_sync')),
  device_id          text,
  captured_at        timestamptz not null default now(),   -- device time at capture
  client_request_id  uuid,                                 -- idempotency key
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1,
  deleted_at         timestamptz,
  unique (id, owner_id),
  foreign key (workspace_id, owner_id)   references public.workspaces (id, owner_id),
  foreign key (parent_task_id, owner_id) references public.tasks (id, owner_id),
  foreign key (meeting_id, owner_id)     references public.meetings (id, owner_id),
  foreign key (person_id, owner_id)      references public.people (id, owner_id),
  check (status <> 'processed' or converted_entity_id is not null or capture_type in ('idea', 'note', 'general', 'expense'))
);
create index quick_capture_inbox on public.quick_capture (owner_id, captured_at desc)
  where status = 'inbox' and deleted_at is null;
-- Retried / replayed offline writes with the same client_request_id are rejected as duplicates.
create unique index quick_capture_client_request on public.quick_capture (owner_id, client_request_id)
  where client_request_id is not null;
create trigger quick_capture_touch before update on public.quick_capture
  for each row execute function public.touch_versioned();

-- ---------------------------------------------------------------------------
-- reminders (scheduled) and notifications (delivered, in-app feed)
-- ---------------------------------------------------------------------------
create table public.reminders (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null check (length(btrim(title)) > 0),
  body          text,
  remind_at     timestamptz not null,
  channels      text[] not null default array['in_app']
                  check (channels <@ array['in_app', 'push', 'email']),
  kind          text not null default 'custom'
                  check (kind in ('custom', 'deadline', 'meeting', 'commitment', 'follow_up',
                                  'daily_review', 'weekly_review')),
  task_id       uuid,
  commitment_id uuid,
  meeting_id    uuid,
  event_id      uuid,
  status        text not null default 'pending'
                  check (status in ('pending', 'sent', 'failed', 'cancelled', 'snoozed')),
  attempts      integer not null default 0,
  last_error    text,
  sent_at       timestamptz,
  -- Stops the scheduler from creating the same reminder twice (e.g. "task X due-soon on date D").
  dedupe_key    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (task_id, owner_id)       references public.tasks (id, owner_id) on delete cascade,
  foreign key (commitment_id, owner_id) references public.commitments (id, owner_id) on delete cascade,
  foreign key (meeting_id, owner_id)    references public.meetings (id, owner_id) on delete cascade,
  foreign key (event_id, owner_id)      references public.calendar_events (id, owner_id) on delete cascade,
  check (num_nonnulls(task_id, commitment_id, meeting_id, event_id) <= 1)
);
create index reminders_due on public.reminders (remind_at) where status = 'pending';
create unique index reminders_dedupe on public.reminders (owner_id, dedupe_key)
  where dedupe_key is not null;
create trigger reminders_updated before update on public.reminders
  for each row execute function public.set_updated_at();

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reminder_id uuid references public.reminders (id) on delete set null,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,                -- in-app route to open
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_unread on public.notifications (owner_id, created_at desc)
  where read_at is null;

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth_secret  text not null,
  device_label text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_owner on public.push_subscriptions (owner_id);

-- ---------------------------------------------------------------------------
-- sync_queue: SERVER-SIDE ledger of operations received from devices.
-- The pending queue itself lives in IndexedDB on the device; this table makes replays
-- idempotent (unique op_id) and records conflicts instead of silently dropping them.
-- ---------------------------------------------------------------------------
create table public.sync_queue (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  op_id           uuid not null,          -- client-generated, stable across retries
  device_id       text not null,
  entity_type     text not null,
  entity_id       uuid,
  operation       text not null check (operation in ('create', 'update', 'delete')),
  payload         jsonb not null,
  base_version    integer,                -- row version the device edited from (conflict detection)
  status          text not null default 'pending'
                    check (status in ('pending', 'applied', 'conflict', 'failed', 'resolved')),
  conflict_detail jsonb,
  attempts        integer not null default 0,
  last_error      text,
  client_created_at timestamptz,
  received_at     timestamptz not null default now(),
  applied_at      timestamptz,
  unique (owner_id, op_id)
);
create index sync_queue_status on public.sync_queue (owner_id, status);
