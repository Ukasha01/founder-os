-- 0002_identity_workspaces.sql
-- profiles, user_settings, workspaces, workspace_members, and first-login seeding.

-- ---------------------------------------------------------------------------
-- profiles: 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  display_name            text,
  avatar_url              text,
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_settings: timezone, scoring weights, capacity, dashboard layout, prefs
-- ---------------------------------------------------------------------------
create function public.is_valid_scoring_weights(w jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(w) = 'object'
     and (select array_agg(k order by k) from jsonb_object_keys(w) as k)
         = array['habits', 'hours', 'kpis', 'planning', 'tasks']
     and not exists (
       select 1 from jsonb_each(w) e
       where jsonb_typeof(e.value) <> 'number' or (e.value)::text::numeric < 0
     )
     and (select sum((e.value)::text::numeric) from jsonb_each(w) e) = 100;
$$;

create table public.user_settings (
  owner_id               uuid primary key default auth.uid()
                           references auth.users (id) on delete cascade,
  timezone               text not null default 'Asia/Karachi'
                           check (public.is_valid_timezone(timezone)),
  week_starts_on         smallint not null default 1 check (week_starts_on between 0 and 6), -- 0=Sun
  -- Editable daily-score weights. Keys: tasks, hours, kpis, habits, planning. Must sum to 100.
  scoring_weights        jsonb not null
                           default '{"tasks":40,"hours":20,"kpis":15,"habits":15,"planning":10}'::jsonb
                           check (public.is_valid_scoring_weights(scoring_weights)),
  -- Available working minutes per weekday, e.g. {"mon":480,"tue":480,...}.
  -- Empty object = not configured yet -> no overload warnings are produced.
  daily_capacity_minutes jsonb not null default '{}'::jsonb,
  dashboard_layout       jsonb not null default '{}'::jsonb,   -- widgets, order, visible workspaces
  ui_density             text  not null default 'expanded' check (ui_density in ('compact', 'expanded')),
  notification_prefs     jsonb not null default '{}'::jsonb,   -- per type: channels, lead times, quiet hours
  locale                 text  not null default 'en',
  ai_enabled             boolean not null default true,
  google_calendar_export_enabled boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger user_settings_updated before update on public.user_settings
  for each row execute function public.set_updated_at();

-- Today's date in the user's configured timezone. Used for overdue detection etc.
create function public.user_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce(
            (select s.timezone from public.user_settings s where s.owner_id = auth.uid()),
            'UTC'))::date;
$$;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  description text,
  icon        text,                       -- icon key, mapped to an icon in the UI
  color       text,                       -- design-token name, not a raw hex
  aliases     text[] not null default '{}', -- extra names the AI assistant can resolve ("deen", "fitness")
  seed_key    text,                       -- stable id for the six defaults, survives renames
  sort_order  integer not null default 0,
  is_private  boolean not null default true,  -- future: only non-private workspaces can be shared
  settings    jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1,
  unique (id, owner_id)
);
-- No two ACTIVE workspaces with the same name; archived ones may collide so restore needs a check.
create unique index workspaces_owner_name_active
  on public.workspaces (owner_id, lower(name)) where archived_at is null;
create unique index workspaces_owner_seed_key
  on public.workspaces (owner_id, seed_key) where seed_key is not null;
create trigger workspaces_touch before update on public.workspaces
  for each row execute function public.touch_versioned();

-- ---------------------------------------------------------------------------
-- workspace_members: prepared for future selective Wapsi collaboration.
-- v1 policies do NOT grant access through this table; it only records the owner row.
-- ---------------------------------------------------------------------------
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner', 'admin', 'member', 'viewer')),
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user on public.workspace_members (user_id);

-- Every new workspace automatically gets its owner membership row.
create function public.add_workspace_owner_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;
create trigger workspaces_owner_member after insert on public.workspaces
  for each row execute function public.add_workspace_owner_member();

-- ---------------------------------------------------------------------------
-- Seeding: profile, settings and the six default workspaces. Idempotent.
-- ---------------------------------------------------------------------------
create function public.seed_default_workspaces(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspaces (owner_id, name, description, icon, color, aliases, seed_key, sort_order)
  values
    (p_owner, 'Wapsi',   'Startup, product, pilots, merchants, integrations and fundraising.',
       'rocket',         'blue',   array['wapsi'],            'wapsi', 1),
    (p_owner, 'KEELVON', 'Ecommerce, marketing, orders, returns and profitability.',
       'shopping-cart',  'orange', array['keelvon'],          'keelvon', 2),
    (p_owner, 'Baby Products', 'Product research, suppliers, inventory and sales.',
       'baby',           'pink',   array['baby'],             'baby-products', 3),
    (p_owner, 'University', 'Courses, assignments, exams and study sessions.',
       'graduation-cap', 'violet', array['uni', 'study'],     'university', 4),
    (p_owner, 'Personal Development & Fitness', 'Learning, workouts, sleep and personal goals.',
       'dumbbell',       'green',  array['fitness', 'personal development'], 'personal-development-fitness', 5),
    (p_owner, 'Deen & Spiritual Growth', 'Namaz, Quran, learning and spiritual routines.',
       'moon',           'teal',   array['deen', 'spiritual'], 'deen-spiritual-growth', 6)
  on conflict (owner_id, seed_key) where seed_key is not null do nothing;
end;
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.user_settings (owner_id) values (new.id)
  on conflict (owner_id) do nothing;

  perform public.seed_default_workspaces(new.id);
  return new;
end;
$$;

-- On Supabase this fires for every email/password and Google sign-up.
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
