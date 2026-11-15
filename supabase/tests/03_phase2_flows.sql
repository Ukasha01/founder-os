-- Replays the exact database operations the Phase 2 screens perform, as a signed-in user.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'p2@example.com');
do $$
declare cap uuid := 'f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0'; ws uuid; t uuid; t2 uuid; child uuid; ids uuid[]; n int; r public.tasks;
begin
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';

  -- Quick Capture then Inbox convert (capture id doubles as task client_request_id)
  insert into public.quick_capture (id, raw_text, capture_type, client_request_id) values (cap, 'Email Nazir the pilot terms', 'task', gen_random_uuid());
  insert into public.tasks (workspace_id, title, priority, current_deadline, source, client_request_id)
    values (ws, 'Email Nazir the pilot terms', 'high', public.user_today() - 2, 'capture', cap) returning id into t;
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.tasks (workspace_id, title, client_request_id) values (%L, 'dup', %L)$q$, ws, cap)) = '23505', 'converting the same capture twice cannot create two tasks');
  update public.quick_capture set status='processed', workspace_id=ws, converted_entity_type='task', converted_entity_id=t where id = cap;
  perform tests.ok((select count(*) from public.quick_capture where status='inbox') = 0, 'converted capture leaves the inbox');

  -- Subtasks under it; child must take parent workspace
  insert into public.tasks (workspace_id, parent_task_id, title) values (ws, t, 'Draft terms') returning id into child;
  insert into public.tasks (workspace_id, parent_task_id, title) values (ws, child, 'Check legal') returning id into t2;
  perform tests.ok((select child_count from public.task_overview where id = t) = 1, 'overview shows child count');
  perform tests.ok((select is_overdue from public.task_overview where id = t), 'task due 2 days ago shows overdue');

  -- Reschedule via the same RPC the page uses, history keeps the original
  r := public.reschedule_task(t, public.user_today() + 5, 'waiting for Nazir');
  perform tests.ok(r.original_deadline = public.user_today() - 2 and r.status = 'not_started', 'reschedule keeps original deadline and status');

  -- Manual time entry as the page inserts it
  insert into public.time_entries (task_id, workspace_id, duration_minutes, source, note, client_request_id)
    values (t2, ws, 90, 'manual', 'legal review', 'abababab-abab-abab-abab-abababababab');
  perform tests.ok(tests.sqlstate_of($q$insert into public.time_entries (task_id, workspace_id, duration_minutes, source, client_request_id) values ((select id from public.tasks where title='Check legal'), (select id from public.workspaces where seed_key='wapsi'), 90, 'manual', 'abababab-abab-abab-abab-abababababab')$q$) = '23505', 'double-submitted time entry is rejected as duplicate');
  perform tests.ok((select actual_minutes from public.task_overview where id = t2) = 90, 'logged time shows on the task');

  -- Soft delete of a subtree exactly as deleteTask does it
  select array_agg(id) into ids from public.get_task_subtree(t);
  perform tests.ok(array_length(ids, 1) = 3, 'subtree lookup returns the task and both descendants');
  update public.tasks set deleted_at = now() where id = any(ids);
  perform tests.ok((select count(*) from public.task_overview where id = any(ids)) = 0, 'deleted subtree disappears from lists');
  perform tests.ok((select count(*) from public.task_activity where task_id = any(ids) and action = 'deleted') = 3, 'deletion of each task is recorded in history');
  select count(*) into n from public.tasks where id = any(ids);
  perform tests.ok(n = 3, 'soft delete keeps the rows (history and audit retained)');
end $$;
