-- Replays every kind of write the Phase 4b assistant performs, using the same columns and values, plus its safety rules.
\set ON_ERROR_STOP 1
alter table public.user_settings add column if not exists ai_auto_approve boolean not null default false;
insert into auth.users (id, email) values ('99999999-aaaa-aaaa-aaaa-999999999999', 'v2a@example.com'), ('99999999-bbbb-bbbb-bbbb-999999999999', 'v2b@example.com');
do $$
declare ws uuid; ws2 uuid; t uuid; sub uuid; g uuid; m uuid; h uuid; k uuid; p uuid; mt uuid; cm uuid; c uuid; l uuid; d date := public.user_today(); n int;
begin
  perform set_config('request.jwt.claim.sub', '99999999-aaaa-aaaa-aaaa-999999999999', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';
  select id into ws2 from public.workspaces where seed_key = 'keelvon';

  -- tasks
  insert into public.tasks (workspace_id, title, priority, current_deadline, estimated_minutes, source, client_request_id) values (ws, 'Call courier', 'high', d + 1, 30, 'ai', gen_random_uuid()) returning id into t;
  insert into public.tasks (workspace_id, parent_task_id, title, source) values (ws, t, 'Prepare list', 'ai') returning id into sub;
  update public.tasks set title = 'Call courier partner', status = 'in_progress', priority = 'critical', estimated_minutes = 45 where id = t;
  perform tests.ok((select status::text || priority::text || estimated_minutes::text from public.tasks where id = t) = 'in_progresscritical45', 'update_task changes title, status, priority, estimate');
  perform public.reschedule_task(t, d + 3, 'Moved by assistant');
  perform tests.ok((select current_deadline from public.tasks where id = t) = d + 3 and (select original_deadline from public.tasks where id = t) = d + 1, 'reschedule keeps the original deadline');
  perform public.move_task_to_workspace(t, ws2);
  perform tests.ok((select workspace_id from public.tasks where id = sub) = ws2, 'move_task carries subtasks along');
  insert into public.time_entries (task_id, workspace_id, duration_minutes, source, client_request_id) values (t, ws2, 20, 'manual', gen_random_uuid());
  update public.tasks set status = 'completed' where id = t;
  perform tests.ok((select completed_at is not null from public.tasks where id = t), 'completing a task sets completed_at (used by the performance report)');
  update public.tasks set deleted_at = now() where id = sub;
  perform tests.ok((select deleted_at is not null from public.tasks where id = sub), 'delete_task is a soft delete');

  -- goals and milestones
  insert into public.goals (workspace_id, name, target_date, success_criteria) values (ws, 'Reach 10 pilot merchants', d + 60, '10 signed') returning id into g;
  insert into public.milestones (goal_id, title, target_value, unit) values (g, 'Signed merchants', 10, 'merchants') returning id into m;
  update public.milestones set current_value = 3, status = 'in_progress' where id = m;
  perform tests.ok((select current_value from public.milestones where id = m) = 3, 'milestone progress recorded');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.milestones (goal_id, title) values (%L, 'vague')$q$, g)) = '23514', 'unmeasurable milestone refused');
  update public.goals set status = 'paused' where id = g;
  perform tests.ok((select status from public.goals where id = g) = 'paused', 'goal status changes');

  -- habits
  insert into public.habits (name, frequency_type, weekdays, start_date) values ('Walk', 'weekdays', array[1,2,3], d) returning id into h;
  insert into public.habit_entries (habit_id, entry_date, status) values (h, d, 'done') on conflict (habit_id, entry_date) do update set status = excluded.status;
  insert into public.habit_entries (habit_id, entry_date, status) values (h, d, 'partial') on conflict (habit_id, entry_date) do update set status = excluded.status;
  perform tests.ok((select count(*) from public.habit_entries where habit_id = h) = 1 and (select status from public.habit_entries where habit_id = h) = 'partial', 'log_habit upserts one entry per day');
  delete from public.habit_entries where habit_id = h and entry_date = d;
  perform tests.ok((select count(*) from public.habit_entries where habit_id = h) = 0, 'clearing a habit day works');
  perform tests.ok(tests.sqlstate_of($q$insert into public.habits (name, frequency_type) values ('Bad', 'weekdays')$q$) = '23514', 'weekday habit without weekdays refused');

  -- KPIs
  insert into public.kpi_definitions (workspace_id, name, unit, target_value, direction, period, aggregation) values (ws, 'Sales', 'orders', 20, 'higher_is_better', 'week', 'sum') returning id into k;
  insert into public.kpi_entries (kpi_id, period_start, period_end, actual_value) values (k, d - 6, d, 12) on conflict (kpi_id, period_start, period_end) do update set actual_value = excluded.actual_value;
  insert into public.kpi_entries (kpi_id, period_start, period_end, actual_value) values (k, d - 6, d, 14) on conflict (kpi_id, period_start, period_end) do update set actual_value = excluded.actual_value;
  perform tests.ok((select count(*) from public.kpi_entries where kpi_id = k) = 1 and (select actual_value from public.kpi_entries where kpi_id = k) = 14, 'record_kpi replaces the same period');

  -- people, meetings, commitments, events
  insert into public.people (name, organization) values ('Ali Khan', 'Courier Co') returning id into p;
  insert into public.meetings (title, workspace_id, starts_at, ends_at, location, agenda) values ('Call with Ali', ws, now() + interval '1 day', now() + interval '1 day 1 hour', 'Zoom', 'Rates') returning id into mt;
  perform tests.ok((select count(*) from public.calendar_events where title = 'Call with Ali') >= 1, 'a meeting is mirrored onto the calendar');
  update public.meetings set notes = 'Agreed rates', decisions = 'Start Monday', status = 'held' where id = mt;
  insert into public.commitments (description, due_date, made_to_person_id, client_request_id) values ('Send rate card', d + 2, p, gen_random_uuid()) returning id into cm;
  perform tests.ok((select made_to_person_id from public.commitments where id = cm) = p, 'commitment by me links the person');
  update public.commitments set status = 'completed' where id = cm;
  perform tests.ok((select completed_at is not null from public.commitments where id = cm), 'completing a commitment sets completed_at');
  insert into public.calendar_events (title, event_type, workspace_id, start_at, end_at, client_request_id) values ('Gym', 'time_block', ws, now() + interval '2 hours', now() + interval '3 hours', gen_random_uuid());

  -- recurring and review
  insert into public.recurrence_rules (workspace_id, name, target_kind, freq, interval_count, by_weekday, start_date, template) values (ws, 'Weekly report', 'task', 'weekly', 1, array[5], d, '{"title":"Weekly report","priority":"normal"}');
  perform tests.ok((select count(*) from public.recurrence_rules where name = 'Weekly report') = 1, 'recurring task rule created');
  insert into public.daily_reviews (review_date, wins, blockers) values (d, 'Shipped demo', 'Slow courier') on conflict (owner_id, review_date) do update set wins = excluded.wins, blockers = excluded.blockers;
  insert into public.daily_reviews (review_date, tomorrow_plan, review_completed_at) values (d, 'Follow up', now()) on conflict (owner_id, review_date) do update set tomorrow_plan = excluded.tomorrow_plan, review_completed_at = excluded.review_completed_at;
  perform tests.ok((select count(*) from public.daily_reviews where review_date = d) = 1 and (select wins from public.daily_reviews where review_date = d) = 'Shipped demo', 'review upsert merges instead of duplicating');

  -- confirmation rule: a delete cannot execute without approval, even if the app forgot
  insert into public.ai_conversations (title) values ('x') returning id into c;
  insert into public.ai_action_logs (conversation_id, tool_name, tool_kind, requires_confirmation, proposed_input, status, idempotency_key)
    values (c, 'delete_task', 'write', true, '{}', 'awaiting_approval', 'k-del') returning id into l;
  perform tests.ok(tests.sqlstate_of(format($q$update public.ai_action_logs set status = 'executing' where id = %L$q$, l)) = '23514', 'a delete cannot start without approved_at');
  insert into public.ai_action_logs (conversation_id, tool_name, tool_kind, proposed_input, status, idempotency_key, executed_at) values (c, 'get_performance', 'read', '{"period":"week"}', 'executed', 'k-read', now());
  perform tests.ok((select count(*) from public.ai_action_logs where tool_kind = 'read') = 1, 'read calls are logged for audit');

  -- the auto-approve setting
  update public.user_settings set ai_auto_approve = true where owner_id is not null;
  perform tests.ok((select ai_auto_approve from public.user_settings) = true, 'auto-approve can be switched on');
end $$;

-- performance report inputs are not visible to another user
do $$
begin
  perform set_config('request.jwt.claim.sub', '99999999-bbbb-bbbb-bbbb-999999999999', true);
  set local role authenticated;
  perform tests.ok((select count(*) from public.tasks) = 0 and (select count(*) from public.goals) = 0 and (select count(*) from public.habits) = 0
    and (select count(*) from public.kpi_entries) = 0 and (select count(*) from public.people) = 0 and (select count(*) from public.ai_action_logs) = 0, 'a second user sees none of the first user''s data');
  perform tests.ok((select ai_auto_approve from public.user_settings) = false, 'auto-approve is per user and defaults off');
end $$;
