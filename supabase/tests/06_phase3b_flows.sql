-- Replays database operations the Phase 3b screens (habits, KPIs) perform.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('33333333-bbbb-bbbb-bbbb-333333333333', 'p3b@example.com');
do $$
declare ws uuid; h uuid; hw uuid; k uuid;
begin
  perform set_config('request.jwt.claim.sub', '33333333-bbbb-bbbb-bbbb-333333333333', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';

  insert into public.habits (name, preset, frequency_type, start_date) values ('Namaz', 'namaz', 'daily', public.user_today() - 10) returning id into h;
  insert into public.habits (name, frequency_type, weekdays) values ('Gym', 'weekdays', array[1,3,5]::smallint[]) returning id into hw;
  perform tests.ok(tests.sqlstate_of($q$insert into public.habits (name, frequency_type) values ('bad', 'weekdays')$q$) = '23514', 'weekday habit needs weekdays');
  perform tests.ok(tests.sqlstate_of($q$insert into public.habits (name, frequency_type) values ('bad2', 'weekly_target')$q$) = '23514', 'weekly-target habit needs a target');

  -- upsert as the screen does: re-logging the same day replaces, never duplicates
  insert into public.habit_entries (habit_id, entry_date, status) values (h, public.user_today(), 'done')
    on conflict (habit_id, entry_date) do update set status = excluded.status, value = excluded.value;
  insert into public.habit_entries (habit_id, entry_date, status, value) values (h, public.user_today(), 'partial', 5)
    on conflict (habit_id, entry_date) do update set status = excluded.status, value = excluded.value;
  perform tests.ok((select count(*) from public.habit_entries where habit_id = h) = 1 and (select status from public.habit_entries where habit_id = h) = 'partial', 'logging a day twice keeps one row, latest wins');
  insert into public.habit_entries (habit_id, entry_date, status) values (h, public.user_today() - 3, 'done');
  perform tests.ok((select count(*) from public.habit_entries where habit_id = h) = 2, 'past days can be logged');
  delete from public.habit_entries where habit_id = h and entry_date = public.user_today();
  perform tests.ok((select count(*) from public.habit_entries where habit_id = h) = 1, 'clearing a day removes the entry');
  update public.habits set archived_at = now() where id = hw;
  perform tests.ok((select count(*) from public.habit_entries where habit_id = hw) = 0 and (select count(*) from public.habits where id = hw) = 1, 'archiving keeps the habit row');

  -- KPIs
  insert into public.kpi_definitions (workspace_id, name, unit, target_value, period) values (ws, 'Orders', 'orders', 50, 'week') returning id into k;
  insert into public.kpi_entries (kpi_id, period_start, period_end, actual_value) values (k, public.user_today() - 6, public.user_today(), 12)
    on conflict (kpi_id, period_start, period_end) do update set actual_value = excluded.actual_value;
  insert into public.kpi_entries (kpi_id, period_start, period_end, actual_value) values (k, public.user_today() - 6, public.user_today(), 20)
    on conflict (kpi_id, period_start, period_end) do update set actual_value = excluded.actual_value;
  perform tests.ok((select count(*) from public.kpi_entries where kpi_id = k) = 1 and (select actual_value from public.kpi_entries where kpi_id = k) = 20, 'recording a KPI period twice replaces the value');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.kpi_entries (kpi_id, period_start, period_end, actual_value) values (%L, current_date, current_date - 1, 1)$q$, k)) = '23514', 'KPI period end before start rejected');
  perform tests.ok((select count(*) from public.kpi_entries where kpi_id = k and period_start > public.user_today()) = 0, 'a KPI with no entry for a period has no row (no data, not zero)');
end $$;
