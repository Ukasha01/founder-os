-- Replays the database operations of the goals, timer and calendar screens.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'p2b@example.com');
do $$
declare ws uuid; g uuid; m1 uuid; run uuid; ev uuid; t uuid; n int; cap jsonb;
begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';

  -- Goals + measurable milestones
  insert into public.goals (workspace_id, name, start_date, target_date) values (ws, 'Run 3 pilots', '2026-11-01', '2026-12-31') returning id into g;
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.goals (workspace_id, name, start_date, target_date) values (%L, 'bad dates', '2026-12-31', '2026-11-01')$q$, ws)) = '23514', 'goal with target before start is rejected');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.milestones (goal_id, title) values (%L, 'Vibes')$q$, g)) = '23514', 'milestone with no number and no measure is rejected');
  insert into public.milestones (goal_id, title, target_value, unit) values (g, 'Pilots live', 3, 'pilots') returning id into m1;
  perform tests.ok(coalesce((select progress_percent from public.goal_progress where goal_id = g), 0) = 0, 'new goal progress is 0%');
  update public.milestones set current_value = 2 where id = m1;
  perform tests.ok((select progress_percent from public.goal_progress where goal_id = g) = 66.7, 'goal progress follows milestone numbers (2 of 3 = 66.7%)');
  update public.milestones set status = 'achieved', achieved_at = now() where id = m1;
  perform tests.ok((select progress_percent from public.goal_progress where goal_id = g) = 100.0, 'achieved milestone counts as 100%');
  update public.goals set deleted_at = now() where id = g;
  perform tests.ok((select count(*) from public.goal_progress where goal_id = g) = 0, 'soft-deleted goal disappears from progress');

  -- Timer: start, second start blocked, stop computes duration
  insert into public.time_entries (workspace_id, started_at, source) values (ws, now() - interval '30 minutes', 'timer') returning id into run;
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.time_entries (workspace_id, started_at, source) values (%L, now(), 'timer')$q$, ws)) = '23505', 'second timer is blocked');
  update public.time_entries set ended_at = now() where id = run and ended_at is null;
  perform tests.ok((select duration_minutes from public.time_entries where id = run) between 29 and 31, 'stop computes ~30 minutes');
  update public.time_entries set ended_at = now() + interval '1 hour' where id = run and ended_at is null;
  perform tests.ok((select duration_minutes from public.time_entries where id = run) between 29 and 31, 'stopping an already stopped timer changes nothing');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.time_entries (workspace_id, started_at, source) values (%L, now(), 'timer')$q$, ws)) is null, 'a new timer can start after stopping');

  -- Calendar event stored as UTC from a Karachi-local time (14:30 PKT = 09:30 UTC)
  insert into public.calendar_events (title, event_type, start_at, end_at, is_fixed, client_request_id)
    values ('Study block', 'time_block', '2026-11-15T09:30:00Z', '2026-11-15T11:30:00Z', false, 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1') returning id into ev;
  perform tests.ok((select (start_at at time zone 'Asia/Karachi')::time from public.calendar_events where id = ev) = '14:30', 'event reads back as 14:30 in Karachi time');
  perform tests.ok(tests.sqlstate_of($q$insert into public.calendar_events (title, start_at, end_at) values ('Backwards', '2026-11-15T10:00:00Z', '2026-11-15T09:00:00Z')$q$) = '23514', 'event ending before it starts is rejected');
  perform tests.ok(tests.sqlstate_of($q$insert into public.calendar_events (title, start_at, client_request_id) values ('dup', now(), 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1')$q$) = '23505', 'double-submitted event is rejected as duplicate');

  -- Task estimate + deadline feed the calendar overload warning
  insert into public.tasks (workspace_id, title, current_deadline, estimated_minutes) values (ws, 'Write proposal', '2026-11-16', 300) returning id into t;
  perform tests.ok((select estimated_minutes from public.task_overview where id = t) = 300, 'task estimate is stored and readable');
  perform tests.ok(tests.sqlstate_of(format($q$update public.tasks set estimated_minutes = -5 where id = %L$q$, t)) = '23514', 'negative estimate rejected');

  -- Capacity setting
  update public.user_settings set daily_capacity_minutes = '{"mon":240,"tue":360}'::jsonb where owner_id = auth.uid();
  select daily_capacity_minutes into cap from public.user_settings where owner_id = auth.uid();
  perform tests.ok((cap ->> 'mon')::int = 240, 'working-hours capacity saved');
end $$;
