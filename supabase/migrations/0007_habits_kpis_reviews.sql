-- 0007_habits_kpis_reviews.sql
-- Habits, KPIs, and daily / weekly reviews.

-- ---------------------------------------------------------------------------
-- habits
-- A missed day is never an irreversible failure: entries can be added or edited for
-- past dates, and 'skipped' (excused) days do not break a streak. Streak and weekly
-- consistency are computed from habit_entries by code, not stored.
-- ---------------------------------------------------------------------------
create table public.habits (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id   uuid,
  name           text not null check (length(btrim(name)) > 0),
  preset         text check (preset in ('namaz', 'quran', 'exercise', 'reading', 'learning', 'sleep')),
  description    text,
  frequency_type text not null default 'daily'
                   check (frequency_type in ('daily', 'weekdays', 'weekly_target')),
  weekdays       smallint[],        -- for 'weekdays' (0=Sun..6=Sat)
  weekly_target  smallint check (weekly_target is null or weekly_target between 1 and 7),
  unit           text,              -- optional measured unit (pages, minutes)
  start_date     date not null default current_date,
  sort_order     integer not null default 0,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id),
  check (frequency_type <> 'weekdays' or weekdays is not null),
  check (frequency_type <> 'weekly_target' or weekly_target is not null)
);
create trigger habits_updated before update on public.habits
  for each row execute function public.set_updated_at();

create table public.habit_entries (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id    uuid not null,
  entry_date  date not null,
  status      text not null default 'done' check (status in ('done', 'partial', 'skipped')),
  value       numeric,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (habit_id, owner_id) references public.habits (id, owner_id) on delete cascade,
  unique (habit_id, entry_date)
);
create index habit_entries_owner_date on public.habit_entries (owner_id, entry_date);
create trigger habit_entries_updated before update on public.habit_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- KPIs. A period with no kpi_entries row means "no data", which scoring must treat as
-- unavailable, never as zero.
-- ---------------------------------------------------------------------------
create table public.kpi_definitions (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id      uuid not null,
  name              text not null check (length(btrim(name)) > 0),
  unit              text,
  target_value      numeric,
  direction         text not null default 'higher_is_better'
                      check (direction in ('higher_is_better', 'lower_is_better')),
  period            text not null default 'week'
                      check (period in ('day', 'week', 'month', 'quarter', 'year')),
  update_frequency  text not null default 'weekly'
                      check (update_frequency in ('daily', 'weekly', 'monthly', 'manual')),
  aggregation       text not null default 'sum' check (aggregation in ('sum', 'latest', 'average')),
  show_on_dashboard boolean not null default false,
  notes             text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id)
);
create index kpi_definitions_workspace on public.kpi_definitions (owner_id, workspace_id)
  where archived_at is null;
create trigger kpi_definitions_updated before update on public.kpi_definitions
  for each row execute function public.set_updated_at();

create table public.kpi_entries (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kpi_id      uuid not null,
  period_start date not null,
  period_end   date not null,
  actual_value numeric not null,
  note         text,
  source       text not null default 'manual' check (source in ('manual', 'ai', 'sync')),
  recorded_at  timestamptz not null default now(),
  client_request_id uuid,
  foreign key (kpi_id, owner_id) references public.kpi_definitions (id, owner_id) on delete cascade,
  check (period_end >= period_start),
  unique (kpi_id, period_start, period_end)
);
create index kpi_entries_kpi_period on public.kpi_entries (kpi_id, period_start desc);
create unique index kpi_entries_client_request on public.kpi_entries (owner_id, client_request_id)
  where client_request_id is not null;

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
create table public.daily_reviews (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  review_date        date not null,
  planned_minutes    integer,
  actual_minutes     integer,
  -- Transparent score: per-category points, max, availability and explanation, plus the
  -- weights used that day, so a later weight change never rewrites history.
  score_total        numeric(5, 1) check (score_total is null or score_total between 0 and 100),
  score_breakdown    jsonb not null default '{}'::jsonb,
  weights_snapshot   jsonb,
  rescheduled_count  integer not null default 0,   -- recorded separately, never counted as failure
  cancelled_count    integer not null default 0,   -- excluded from the score
  plan_completed_at  timestamptz,                  -- when the day was planned
  review_completed_at timestamptz,
  wins               text,
  blockers           text,
  tomorrow_plan      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (owner_id, review_date)
);
create trigger daily_reviews_updated before update on public.daily_reviews
  for each row execute function public.set_updated_at();

create table public.weekly_reviews (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_start       date not null,
  summary          jsonb not null default '{}'::jsonb,   -- computed numbers snapshot
  wins             text,
  challenges       text,
  next_week_focus  text,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (owner_id, week_start)
);
create trigger weekly_reviews_updated before update on public.weekly_reviews
  for each row execute function public.set_updated_at();
