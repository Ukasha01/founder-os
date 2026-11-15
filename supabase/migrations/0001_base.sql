-- 0001_base.sql
-- Shared enums and generic trigger helpers used by every later migration.
-- All app tables live in the `public` schema and are owned per-user via owner_id.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums for the core fixed vocabularies defined in the product spec.
-- Less stable vocabularies elsewhere use text + CHECK so they are cheap to change.
-- ---------------------------------------------------------------------------
create type public.task_status as enum
  ('not_started', 'in_progress', 'waiting', 'completed', 'cancelled');

create type public.task_priority as enum
  ('critical', 'high', 'normal', 'low');

create type public.capture_type as enum
  ('task', 'subtask', 'idea', 'meeting', 'promise', 'commitment',
   'follow_up', 'reminder', 'note', 'expense', 'general');

create type public.capture_status as enum
  ('inbox', 'processed', 'archived');

-- ---------------------------------------------------------------------------
-- Generic row triggers
-- ---------------------------------------------------------------------------

-- For tables that only need updated_at.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- For tables that take part in sync / conflict detection: also bumps `version`.
-- A no-op UPDATE (nothing actually changed) does not bump the version.
create function public.touch_versioned()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'version') = (to_jsonb(old) - 'updated_at' - 'version') then
    new.updated_at := old.updated_at;
    new.version := old.version;
    return new;
  end if;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

-- Timezone validation helper (used by a CHECK on user_settings).
create function public.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;
