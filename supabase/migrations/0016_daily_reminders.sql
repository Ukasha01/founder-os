-- Repeating reminders ("every night at 23:45"). One row per rule; the reminder job turns each rule into an ordinary
-- reminder for today and tomorrow, so delivery, nagging and the Google Calendar alert work exactly as for one-off reminders.
create table if not exists public.daily_reminders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null check (length(btrim(title)) > 0 and length(title) <= 300),
  at_time    time not null,                                   -- local time of day, in the user's timezone
  weekdays   smallint[] check (weekdays is null or weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),   -- 0 = Sunday; null = every day
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists daily_reminders_owner_idx on public.daily_reminders (owner_id) where active;
alter table public.daily_reminders enable row level security;
create policy daily_reminders_select_own on public.daily_reminders for select using (owner_id = auth.uid());
create policy daily_reminders_insert_own on public.daily_reminders for insert with check (owner_id = auth.uid());
create policy daily_reminders_update_own on public.daily_reminders for update using (owner_id = auth.uid());
create policy daily_reminders_delete_own on public.daily_reminders for delete using (owner_id = auth.uid());
grant select, insert, update, delete on public.daily_reminders to authenticated;   -- the assistant and the app read and write it as the signed-in user
