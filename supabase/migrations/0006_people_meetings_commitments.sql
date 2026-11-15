-- 0006_people_meetings_commitments.sql
-- People, meetings (with calendar sync), attendees, commitments, attachments.

create table public.people (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  organization text,
  position     text,
  email        text,
  phone        text,
  other_contact jsonb not null default '{}'::jsonb,
  category     text,                 -- free text: investor, merchant, mentor, faculty, friend...
  workspace_id uuid,
  notes        text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,
  deleted_at   timestamptz,
  unique (id, owner_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id)
);
create index people_name_trgm on public.people using gin (name extensions.gin_trgm_ops);
create index people_owner on public.people (owner_id) where deleted_at is null;
create trigger people_touch before update on public.people
  for each row execute function public.touch_versioned();

create table public.meetings (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid,
  title        text not null check (length(btrim(title)) > 0),
  organization text,
  starts_at    timestamptz,          -- authoritative; mirrored to calendar_events by trigger
  ends_at      timestamptz,
  location     text,
  agenda       text,
  notes        text,
  decisions    text,
  status       text not null default 'scheduled' check (status in ('scheduled', 'held', 'cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,
  deleted_at   timestamptz,
  unique (id, owner_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index meetings_owner_start on public.meetings (owner_id, starts_at desc) where deleted_at is null;
create trigger meetings_touch before update on public.meetings
  for each row execute function public.touch_versioned();

create table public.meeting_attendees (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meeting_id uuid not null,
  person_id  uuid not null,
  role       text,
  attended   boolean,
  primary key (meeting_id, person_id),
  foreign key (meeting_id, owner_id) references public.meetings (id, owner_id) on delete cascade,
  foreign key (person_id, owner_id)  references public.people   (id, owner_id) on delete cascade
);
create index meeting_attendees_person on public.meeting_attendees (person_id);

-- calendar_events.meeting_id (added here because meetings did not exist in 0005)
alter table public.calendar_events add column meeting_id uuid;
alter table public.calendar_events
  add constraint calendar_events_meeting_fk
  foreign key (meeting_id, owner_id) references public.meetings (id, owner_id) on delete cascade;
create unique index calendar_events_one_per_meeting on public.calendar_events (meeting_id)
  where meeting_id is not null;

-- Keep the calendar mirror of a meeting in sync. Meeting times are edited on the meeting.
create function public.sync_meeting_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.starts_at is null or new.deleted_at is not null or new.status = 'cancelled' then
    update public.calendar_events
       set deleted_at = coalesce(deleted_at, now()), status = 'cancelled'
     where meeting_id = new.id and owner_id = new.owner_id;
    return null;
  end if;

  insert into public.calendar_events
    (owner_id, workspace_id, event_type, title, location, start_at, end_at, meeting_id, status)
  values
    (new.owner_id, new.workspace_id, 'meeting', new.title, new.location, new.starts_at, new.ends_at,
     new.id, case when new.status = 'held' then 'completed' else 'scheduled' end)
  on conflict (meeting_id) where meeting_id is not null
  do update set workspace_id = excluded.workspace_id,
                title        = excluded.title,
                location     = excluded.location,
                start_at     = excluded.start_at,
                end_at       = excluded.end_at,
                status       = excluded.status,
                deleted_at   = null;
  return null;
end;
$$;
create trigger meetings_calendar_sync after insert or update on public.meetings
  for each row execute function public.sync_meeting_calendar_event();

-- ---------------------------------------------------------------------------
-- commitments: promises in either direction. A NULL person means "me".
-- ---------------------------------------------------------------------------
create table public.commitments (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id        uuid,
  description         text not null check (length(btrim(description)) > 0),
  made_by_person_id   uuid,          -- NULL = I made it
  made_to_person_id   uuid,          -- NULL = it was made to me
  due_date            date,
  follow_up_date      date,
  status              text not null default 'pending'
                        check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  completed_at        timestamptz,
  meeting_id          uuid,
  follow_up_task_id   uuid,          -- the task created to act on / follow up this commitment
  notes               text,
  client_request_id   uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1,
  deleted_at          timestamptz,
  unique (id, owner_id),
  foreign key (workspace_id, owner_id)      references public.workspaces (id, owner_id),
  foreign key (made_by_person_id, owner_id) references public.people (id, owner_id),
  foreign key (made_to_person_id, owner_id) references public.people (id, owner_id),
  foreign key (meeting_id, owner_id)        references public.meetings (id, owner_id),
  foreign key (follow_up_task_id, owner_id) references public.tasks (id, owner_id),
  -- A promise between "me" and "me" is just a task.
  check (made_by_person_id is not null or made_to_person_id is not null)
);
create index commitments_owner_status on public.commitments (owner_id, status, due_date)
  where deleted_at is null;
create index commitments_person_by on public.commitments (made_by_person_id);
create index commitments_person_to on public.commitments (made_to_person_id);
create unique index commitments_client_request on public.commitments (owner_id, client_request_id)
  where client_request_id is not null;
create trigger commitments_touch before update on public.commitments
  for each row execute function public.touch_versioned();

create function public.commitments_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status <> 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger commitments_a_write before insert or update on public.commitments
  for each row execute function public.commitments_before_write();

-- ---------------------------------------------------------------------------
-- attachments: metadata only; files live in a private Supabase Storage bucket.
-- ---------------------------------------------------------------------------
create table public.attachments (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id        uuid,
  meeting_id     uuid,
  storage_bucket text not null default 'attachments',
  storage_path   text not null,
  file_name      text not null,
  mime_type      text,
  size_bytes     bigint check (size_bytes is null or size_bytes >= 0),
  created_at     timestamptz not null default now(),
  foreign key (task_id, owner_id)    references public.tasks (id, owner_id) on delete cascade,
  foreign key (meeting_id, owner_id) references public.meetings (id, owner_id) on delete cascade,
  check (num_nonnulls(task_id, meeting_id) = 1)
);
create index attachments_task on public.attachments (task_id) where task_id is not null;
create index attachments_meeting on public.attachments (meeting_id) where meeting_id is not null;
