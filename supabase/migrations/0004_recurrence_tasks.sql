-- 0004_recurrence_tasks.sql
-- Recurrence rules, tasks (unlimited nesting), tags, comments, activity history,
-- time entries, plus the invariants that protect task data.

-- ---------------------------------------------------------------------------
-- Recurrence. Occurrences are MATERIALISED as ordinary task/event rows, so editing,
-- rescheduling or completing one occurrence can never change the series or its siblings.
-- ---------------------------------------------------------------------------
create table public.recurrence_rules (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id   uuid,
  name           text not null,
  target_kind    text not null check (target_kind in ('task', 'event')),
  template       jsonb not null default '{}'::jsonb,  -- title, priority, estimate, event_type, duration...
  freq           text not null check (freq in ('daily', 'weekly', 'monthly', 'custom')),
  interval_count integer not null default 1 check (interval_count > 0),
  by_weekday     smallint[],                           -- 0=Sun..6=Sat ("selected weekdays")
  by_monthday    smallint[],
  times_of_day   time[],                               -- several occurrences per day
  custom_rrule   text,                                 -- RFC 5545 string when freq = 'custom'
  start_date     date not null,
  end_date       date,
  is_paused      boolean not null default false,       -- pause/resume
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1,
  unique (id, owner_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id),
  check (end_date is null or end_date >= start_date),
  check (freq <> 'custom' or custom_rrule is not null)
);
create trigger recurrence_rules_touch before update on public.recurrence_rules
  for each row execute function public.touch_versioned();

create table public.recurrence_exceptions (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rule_id         uuid not null,
  occurrence_date date not null,
  occurrence_index smallint not null default 0,
  kind            text not null check (kind in ('skipped', 'rescheduled')),
  new_date        date,
  new_time        time,
  note            text,
  created_at      timestamptz not null default now(),
  foreign key (rule_id, owner_id) references public.recurrence_rules (id, owner_id) on delete cascade,
  unique (rule_id, occurrence_date, occurrence_index),
  check (kind <> 'rescheduled' or new_date is not null)
);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id       uuid not null,
  parent_task_id     uuid,
  title              text not null check (length(btrim(title)) between 1 and 500),
  description        text,
  notes              text,
  status             public.task_status   not null default 'not_started',
  priority           public.task_priority not null default 'normal',
  start_date         date,
  original_deadline  date,     -- set once, never changed afterwards (see trigger)
  current_deadline   date,     -- changes when the task is rescheduled
  due_time           time,
  estimated_minutes  integer check (estimated_minutes is null or estimated_minutes >= 0),
  sort_order         double precision not null default 0,
  completed_at       timestamptz,
  source             text not null default 'manual'
                       check (source in ('manual', 'capture', 'ai', 'recurrence', 'commitment', 'sync')),
  recurrence_rule_id uuid,
  occurrence_date    date,
  occurrence_index   smallint not null default 0,
  client_request_id  uuid,     -- idempotency key for offline / retried creates
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1,
  deleted_at         timestamptz,
  unique (id, owner_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id),
  -- Same owner enforced by the composite key. NO ACTION (not CASCADE): subtree deletion
  -- is done explicitly by the app (soft delete), never by an accidental cascade.
  foreign key (parent_task_id, owner_id) references public.tasks (id, owner_id),
  foreign key (recurrence_rule_id, owner_id) references public.recurrence_rules (id, owner_id),
  check (parent_task_id is null or parent_task_id <> id),
  check (recurrence_rule_id is null or occurrence_date is not null)
);

create index tasks_owner_workspace_status on public.tasks (owner_id, workspace_id, status)
  where deleted_at is null;
create index tasks_parent on public.tasks (parent_task_id) where parent_task_id is not null;
create index tasks_deadline_active on public.tasks (owner_id, current_deadline)
  where deleted_at is null and status not in ('completed', 'cancelled');
create index tasks_title_trgm on public.tasks using gin (title extensions.gin_trgm_ops);
create unique index tasks_client_request on public.tasks (owner_id, client_request_id)
  where client_request_id is not null;
create unique index tasks_recurrence_occurrence
  on public.tasks (recurrence_rule_id, occurrence_date, occurrence_index)
  where recurrence_rule_id is not null;

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------
create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  color      text,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index tags_owner_name on public.tags (owner_id, lower(name));

create table public.task_tags (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id  uuid not null,
  tag_id   uuid not null,
  primary key (task_id, tag_id),
  foreign key (task_id, owner_id) references public.tasks (id, owner_id) on delete cascade,
  foreign key (tag_id, owner_id)  references public.tags  (id, owner_id) on delete cascade
);

create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id    uuid not null,
  body       text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, owner_id) references public.tasks (id, owner_id) on delete cascade
);
create index task_comments_task on public.task_comments (task_id, created_at);
create trigger task_comments_updated before update on public.task_comments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- task_activity: append-only history. Written ONLY by the trigger below
-- (SECURITY DEFINER); users can read but never insert, edit or delete rows.
-- ---------------------------------------------------------------------------
create table public.task_activity (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  task_id      uuid not null,
  actor_id     uuid,
  action       text not null,   -- created | changed | rescheduled | deleted | restored
  field        text,
  old_value    jsonb,
  new_value    jsonb,
  source       text not null default 'user',   -- user | ai | sync | system | recurrence
  reason       text,
  ai_action_id uuid,
  created_at   timestamptz not null default now(),
  foreign key (task_id, owner_id) references public.tasks (id, owner_id) on delete cascade,
  foreign key (ai_action_id, owner_id) references public.ai_action_logs (id, owner_id)
    on delete set null (ai_action_id)
);
create index task_activity_task on public.task_activity (task_id, created_at desc);
create index task_activity_owner_created on public.task_activity (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- time_entries
-- Three shapes: running timer (started_at set, no end, no duration), finished timer,
-- and manual entry ("I worked 2 hours on Wapsi": duration only).
-- ---------------------------------------------------------------------------
create table public.time_entries (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id      uuid not null,   -- derived from the task when task_id is given
  task_id           uuid,
  started_at        timestamptz,
  ended_at          timestamptz,
  duration_minutes  integer check (duration_minutes is null or duration_minutes > 0),
  entry_date        date not null,   -- the day it counts for, in the user's timezone
  source            text not null default 'manual' check (source in ('timer', 'manual', 'ai', 'sync')),
  note              text,
  client_request_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id),
  foreign key (task_id, owner_id) references public.tasks (id, owner_id),
  check (ended_at is null or started_at is null or ended_at >= started_at),
  check (duration_minutes is not null or (started_at is not null and ended_at is null))
);
create index time_entries_owner_date on public.time_entries (owner_id, entry_date);
create index time_entries_task on public.time_entries (task_id) where task_id is not null;
-- At most one running timer per user.
create unique index time_entries_one_running on public.time_entries (owner_id)
  where duration_minutes is null;
create unique index time_entries_client_request on public.time_entries (owner_id, client_request_id)
  where client_request_id is not null;
create trigger time_entries_updated before update on public.time_entries
  for each row execute function public.set_updated_at();

create function public.time_entries_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ws uuid;
  v_tz text;
begin
  if new.task_id is not null then
    select t.workspace_id into v_ws from public.tasks t where t.id = new.task_id;
    if v_ws is not null then
      new.workspace_id := v_ws;
    end if;
  end if;

  if new.ended_at is not null and new.started_at is not null and new.duration_minutes is null then
    new.duration_minutes := greatest(1, round(extract(epoch from (new.ended_at - new.started_at)) / 60)::int);
  end if;

  if new.entry_date is null then
    select s.timezone into v_tz from public.user_settings s where s.owner_id = new.owner_id;
    new.entry_date := (coalesce(new.started_at, now()) at time zone coalesce(v_tz, 'UTC'))::date;
  end if;
  return new;
end;
$$;
-- entry_date is NOT NULL, but BEFORE triggers run before NOT NULL is checked.
create trigger time_entries_derive before insert or update on public.time_entries
  for each row execute function public.time_entries_before_write();

-- ===========================================================================
-- Task invariants
-- ===========================================================================

-- 1) No cycles in the parent chain (and no self-parenting).
create function public.prevent_task_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_task_id is null then
    return new;
  end if;
  if new.parent_task_id = new.id then
    raise exception 'A task cannot be its own parent' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.parent_task_id is not distinct from old.parent_task_id then
    return new;
  end if;

  -- Serialise re-parenting per user so two concurrent moves cannot jointly create a cycle.
  perform pg_advisory_xact_lock(hashtextextended('task-tree:' || new.owner_id::text, 0));

  if exists (
    with recursive anc as (
      select t.id, t.parent_task_id from public.tasks t where t.id = new.parent_task_id
      union
      select t.id, t.parent_task_id from public.tasks t join anc a on t.id = a.parent_task_id
    )
    select 1 from anc where anc.id = new.id
  ) then
    raise exception 'Circular task hierarchy: the new parent is a descendant of this task'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 2) Deadline history, completion timestamp, and "never change status because of dates".
create function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.original_deadline is null then
      new.original_deadline := new.current_deadline;
    end if;
  else
    -- The original deadline is write-once. Rescheduling only moves current_deadline;
    -- the move itself is recorded in task_activity.
    if old.original_deadline is not null then
      new.original_deadline := old.original_deadline;
    elsif new.original_deadline is null then
      new.original_deadline := new.current_deadline;
    end if;
  end if;

  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status <> 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  -- Intentionally nothing here ever touches `status` based on dates.
  return new;
end;
$$;

create trigger tasks_a_cycle before insert or update of parent_task_id on public.tasks
  for each row execute function public.prevent_task_cycle();
create trigger tasks_b_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();
create trigger tasks_c_touch before update on public.tasks
  for each row execute function public.touch_versioned();

-- 3) A child always lives in the same workspace as its parent. Deferred to COMMIT so a whole
--    subtree can be moved in one transaction (see move_task_to_workspace).
create function public.check_task_workspace_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ws     uuid;
  v_parent uuid;
begin
  -- Deferred triggers receive the row as it was when the event was queued. Re-read the
  -- CURRENT row, so a task moved later in the same transaction is checked on its final state.
  select t.workspace_id, t.parent_task_id into v_ws, v_parent
    from public.tasks t where t.id = new.id;
  if not found then
    return null;   -- row no longer exists
  end if;

  if v_parent is not null and exists (
    select 1 from public.tasks p where p.id = v_parent and p.workspace_id <> v_ws
  ) then
    raise exception 'A subtask must belong to the same workspace as its parent'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.tasks c where c.parent_task_id = new.id and c.workspace_id <> v_ws
  ) then
    raise exception 'All subtasks must belong to the same workspace as their parent'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger tasks_workspace_consistency
  after insert or update of workspace_id, parent_task_id on public.tasks
  deferrable initially deferred
  for each row execute function public.check_task_workspace_consistency();

-- 4) Activity log (SECURITY DEFINER so users cannot forge or edit history).
--    Context comes from transaction-local settings the API sets before writing:
--      app.change_source, app.change_reason, app.ai_action_id
create function public.log_task_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src    text := coalesce(nullif(current_setting('app.change_source', true), ''), 'user');
  v_reason text := nullif(current_setting('app.change_reason', true), '');
  v_ai     uuid := nullif(current_setting('app.ai_action_id', true), '')::uuid;
  v_old    jsonb;
  v_new    jsonb;
  f        text;
  v_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.task_activity (owner_id, task_id, actor_id, action, new_value, source, reason, ai_action_id)
    values (new.owner_id, new.id, auth.uid(), 'created',
            jsonb_build_object('title', new.title, 'workspace_id', new.workspace_id,
                               'parent_task_id', new.parent_task_id, 'status', new.status,
                               'priority', new.priority, 'current_deadline', new.current_deadline),
            v_src, v_reason, v_ai);
    return null;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach f in array array['title', 'status', 'priority', 'workspace_id', 'parent_task_id',
                           'start_date', 'original_deadline', 'current_deadline', 'due_time',
                           'estimated_minutes', 'deleted_at']
  loop
    if v_old -> f is distinct from v_new -> f then
      v_action := case
        when f = 'current_deadline' then 'rescheduled'
        when f = 'deleted_at' and new.deleted_at is not null then 'deleted'
        when f = 'deleted_at' then 'restored'
        else 'changed'
      end;
      insert into public.task_activity
        (owner_id, task_id, actor_id, action, field, old_value, new_value, source, reason, ai_action_id)
      values (new.owner_id, new.id, auth.uid(), v_action, f, v_old -> f, v_new -> f, v_src, v_reason, v_ai);
    end if;
  end loop;
  return null;
end;
$$;
create trigger tasks_log after insert or update on public.tasks
  for each row execute function public.log_task_changes();

-- ===========================================================================
-- Hierarchy + progress
-- ===========================================================================

-- Descendants of a task. No fixed nesting limit in the data model; the limits are
-- query-time safety valves (depth and row count) with sensible defaults.
create function public.get_task_subtree(
  p_root uuid,
  p_max_depth integer default 1000,
  p_max_rows integer default 10000
)
returns table (id uuid, parent_task_id uuid, depth integer, path uuid[])
language sql
stable
set search_path = ''
as $$
  with recursive tree as (
    select t.id, t.parent_task_id, 0 as depth, array[t.id] as path
    from public.tasks t
    where t.id = p_root and t.deleted_at is null
    union all
    select c.id, c.parent_task_id, tr.depth + 1, tr.path || c.id
    from public.tasks c
    join tree tr on c.parent_task_id = tr.id
    where c.deleted_at is null
      and tr.depth < p_max_depth
      and not (c.id = any (tr.path))      -- defensive: never loop even if data were corrupt
  )
  select tree.id, tree.parent_task_id, tree.depth, tree.path
  from tree
  order by tree.path
  limit p_max_rows;
$$;

-- Progress is computed from LEAF descendants: percent of non-cancelled leaves that are
-- completed. A parent's own status is ignored when it has active children. Cancelled tasks
-- (and everything below them) are excluded from their ancestors' totals; a task whose only
-- children are cancelled counts as a leaf itself.
-- It walks only from the requested tasks, so a list screen pays for the rows it shows,
-- not for the whole database. UNION (not UNION ALL) makes the walk terminate even on
-- corrupt data. Returns no row for a cancelled task (progress is not applicable).
create function public.get_task_progress(p_task_ids uuid[])
returns table (task_id uuid, total_leaves integer, completed_leaves integer, progress_percent numeric)
language sql
stable
set search_path = ''
as $$
  with recursive walk as (
    select t.id as root_id, t.id as node_id
    from public.tasks t
    where t.id = any (p_task_ids) and t.deleted_at is null and t.status <> 'cancelled'
    union
    select w.root_id, c.id
    from walk w
    join public.tasks c on c.parent_task_id = w.node_id
    where c.deleted_at is null and c.status <> 'cancelled'
  ), leaves as (
    select w.root_id, n.status
    from walk w
    join public.tasks n on n.id = w.node_id
    where not exists (
      select 1 from public.tasks k
      where k.parent_task_id = n.id and k.deleted_at is null and k.status <> 'cancelled'
    )
  )
  select
    l.root_id,
    count(*)::int,
    (count(*) filter (where l.status = 'completed'))::int,
    round(100.0 * count(*) filter (where l.status = 'completed') / count(*), 1)
  from leaves l
  group by l.root_id;
$$;

-- Task list view: child counts, tracked time and overdue flag (user's timezone).
-- is_overdue is DERIVED at read time; it never changes status or deadline.
-- Progress is deliberately NOT part of this view; call get_task_progress() for the visible ids.
create view public.task_overview with (security_invoker = true) as
select
  t.*,
  (select count(*) from public.tasks c
     where c.parent_task_id = t.id and c.deleted_at is null)::int           as child_count,
  coalesce((select sum(te.duration_minutes) from public.time_entries te
              where te.task_id = t.id), 0)::int                              as actual_minutes,
  (t.status not in ('completed', 'cancelled')
     and t.current_deadline is not null
     and t.current_deadline < public.user_today())                           as is_overdue
from public.tasks t
where t.deleted_at is null;

-- ===========================================================================
-- Operations that must be atomic
-- ===========================================================================

-- Reschedule: moves current_deadline; original_deadline stays; the old value is in history.
create function public.reschedule_task(p_task_id uuid, p_new_deadline date, p_reason text default null)
returns public.tasks
language plpgsql
set search_path = ''
as $$
declare
  v_row public.tasks;
begin
  perform set_config('app.change_reason', coalesce(p_reason, ''), true);
  update public.tasks set current_deadline = p_new_deadline
   where id = p_task_id and deleted_at is null
   returning * into v_row;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- Move a task AND its whole subtree to another workspace in one transaction.
-- The moved root is attached to p_new_parent (must already live in the target workspace) or
-- becomes a root task. Time entries follow their tasks.
create function public.move_task_to_workspace(
  p_task_id uuid,
  p_workspace_id uuid,
  p_new_parent uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tasks where id = p_task_id and deleted_at is null) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;

  -- Detach/re-attach the root first (cycle trigger validates p_new_parent).
  update public.tasks set parent_task_id = p_new_parent where id = p_task_id;

  update public.tasks t set workspace_id = p_workspace_id
   where t.id in (select s.id from public.get_task_subtree(p_task_id) s)
     and t.workspace_id <> p_workspace_id;

  update public.time_entries te set workspace_id = p_workspace_id
   where te.task_id in (select s.id from public.get_task_subtree(p_task_id) s)
     and te.workspace_id <> p_workspace_id;
end;
$$;
