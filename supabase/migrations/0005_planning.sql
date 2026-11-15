-- 0005_planning.sql
-- Goals, milestones and calendar events.

-- ---------------------------------------------------------------------------
-- goals + milestones
-- ---------------------------------------------------------------------------
create table public.goals (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id     uuid not null,
  name             text not null check (length(btrim(name)) > 0),
  description      text,
  start_date       date,
  target_date      date,
  success_criteria text,
  status           text not null default 'active'
                     check (status in ('not_started', 'active', 'achieved', 'paused', 'abandoned')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  deleted_at       timestamptz,
  unique (id, owner_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id),
  check (target_date is null or start_date is null or target_date >= start_date)
);
create index goals_owner_workspace on public.goals (owner_id, workspace_id) where deleted_at is null;
create trigger goals_touch before update on public.goals
  for each row execute function public.touch_versioned();

create table public.milestones (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id             uuid not null,
  title               text not null check (length(btrim(title)) > 0),
  measure_description text,      -- how achievement is measured
  target_value        numeric,
  current_value       numeric not null default 0,
  unit                text,
  due_date            date,
  status              text not null default 'pending'
                        check (status in ('pending', 'in_progress', 'achieved', 'missed', 'cancelled')),
  achieved_at         timestamptz,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (goal_id, owner_id) references public.goals (id, owner_id) on delete cascade,
  -- Milestones must be measurable, not motivational statements.
  constraint milestone_is_measurable
    check (target_value is not null or length(btrim(coalesce(measure_description, ''))) > 0),
  check (target_value is null or target_value > 0)
);
create index milestones_goal on public.milestones (goal_id, sort_order);
create trigger milestones_updated before update on public.milestones
  for each row execute function public.set_updated_at();

-- Goal progress = average completion of non-cancelled milestones
-- (achieved = 100%, otherwise current/target capped at 100% when a numeric target exists).
create view public.goal_progress with (security_invoker = true) as
select
  g.id as goal_id,
  count(m.id) filter (where m.status <> 'cancelled')::int as milestone_count,
  (count(m.id) filter (where m.status = 'achieved'))::int as achieved_count,
  round(100.0 * avg(
    case
      when m.status = 'cancelled' then null
      when m.status = 'achieved' then 1.0
      when m.target_value is not null then least(m.current_value / m.target_value, 1.0)
      else 0.0
    end), 1) as progress_percent
from public.goals g
left join public.milestones m on m.goal_id = g.id
where g.deleted_at is null
group by g.id;

-- ---------------------------------------------------------------------------
-- calendar_events: meetings, classes, appointments, time blocks, fixed commitments.
-- Task deadlines are NOT stored here; the calendar UI reads them from tasks.
-- A task's optional "calendar block" is an event with task_id set.
-- meeting_id is added in 0006 once the meetings table exists.
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id       uuid,
  event_type         text not null default 'other'
                       check (event_type in ('meeting', 'class', 'appointment', 'deadline',
                                             'time_block', 'recurring_activity', 'other')),
  title              text not null check (length(btrim(title)) > 0),
  description        text,
  location           text,
  start_at           timestamptz not null,
  end_at             timestamptz,
  all_day            boolean not null default false,
  is_fixed           boolean not null default false,   -- fixed (university, prayers, sleep) vs flexible work
  status             text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  task_id            uuid,
  recurrence_rule_id uuid,
  occurrence_date    date,
  occurrence_index   smallint not null default 0,
  client_request_id  uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1,
  deleted_at         timestamptz,
  unique (id, owner_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id),
  foreign key (task_id, owner_id) references public.tasks (id, owner_id),
  foreign key (recurrence_rule_id, owner_id) references public.recurrence_rules (id, owner_id),
  check (all_day or end_at is null or end_at >= start_at),
  check (recurrence_rule_id is null or occurrence_date is not null)
);
create index calendar_events_owner_start on public.calendar_events (owner_id, start_at)
  where deleted_at is null;
create unique index calendar_events_client_request on public.calendar_events (owner_id, client_request_id)
  where client_request_id is not null;
create unique index calendar_events_recurrence_occurrence
  on public.calendar_events (recurrence_rule_id, occurrence_date, occurrence_index)
  where recurrence_rule_id is not null;
create trigger calendar_events_touch before update on public.calendar_events
  for each row execute function public.touch_versioned();

-- One-way Google Calendar export bookkeeping. Founder OS stays the source of truth;
-- nothing is ever imported back. The unique keys make repeated exports idempotent.
create table public.external_calendar_links (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id             uuid not null,
  provider             text not null default 'google' check (provider in ('google')),
  external_calendar_id text not null,
  external_event_id    text not null,
  content_hash         text,           -- skip re-export when nothing changed
  last_exported_at     timestamptz not null default now(),
  foreign key (event_id, owner_id) references public.calendar_events (id, owner_id) on delete cascade,
  unique (event_id, provider, external_calendar_id),
  unique (provider, external_calendar_id, external_event_id)
);
