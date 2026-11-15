-- Behavioural tests for the Founder OS schema. Run after 00_stub_supabase.sql + all migrations.
-- Every check raises an exception on failure; the script stops at the first failure.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''

create schema tests;
grant usage on schema tests to public;

create function tests.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'TEST FAILED: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;

-- Runs a statement and returns its SQLSTATE if it fails, or NULL if it succeeds (rolled back).
create function tests.sqlstate_of(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;
grant execute on all functions in schema tests to public;

-- ---------------------------------------------------------------- seeding
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@example.com', '{"full_name":"User A"}'),
  (:B, 'b@example.com', '{}');

do $$ begin
  perform tests.ok((select count(*) from public.workspaces where owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 6,
                   'new user gets exactly six workspaces');
  perform tests.ok((select count(*) from public.workspace_members where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and role='owner') = 6,
                   'owner membership rows created for each workspace');
  perform tests.ok((select display_name from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 'User A', 'profile created');
  perform tests.ok((select timezone from public.user_settings where owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 'Asia/Karachi', 'default timezone is Asia/Karachi');
  perform public.seed_default_workspaces('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  perform tests.ok((select count(*) from public.workspaces where owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 6, 'seeding is idempotent');
end $$;

-- ---------------------------------------------------------------- settings validation
do $$ begin
  perform tests.ok(tests.sqlstate_of($q$update public.user_settings set scoring_weights='{"tasks":40,"hours":20,"kpis":15,"habits":15,"planning":9}' where owner_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$) = '23514', 'scoring weights must sum to 100');
  perform tests.ok(tests.sqlstate_of($q$update public.user_settings set scoring_weights='{"tasks":50,"hours":20,"kpis":10,"habits":10,"planning":10}' where owner_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$) is null, 'valid custom weights accepted');
  perform tests.ok(tests.sqlstate_of($q$update public.user_settings set timezone='Mars/Base' where owner_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$) = '23514', 'invalid timezone rejected');
end $$;

-- ---------------------------------------------------------------- tasks as user A
do $$
declare
  ws uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; r record; n int;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  set local role authenticated;

  select id into ws from public.workspaces where seed_key = 'wapsi';

  -- five nested levels
  insert into public.tasks (workspace_id, title) values (ws, 'L1 Product Development') returning id into t1;
  insert into public.tasks (workspace_id, title, parent_task_id) values (ws, 'L2 Address Verification', t1) returning id into t2;
  insert into public.tasks (workspace_id, title, parent_task_id) values (ws, 'L3 Fix Places verification', t2) returning id into t3;
  insert into public.tasks (workspace_id, title, parent_task_id) values (ws, 'L4 Investigate landmark mismatch', t3) returning id into t4;
  insert into public.tasks (workspace_id, title, parent_task_id) values (ws, 'L5 Reproduce issue', t4) returning id into t5;
  perform set_config('t.ids', array[t1,t2,t3,t4,t5]::text, true);

  perform tests.ok((select count(*) from public.get_task_subtree(t1)) = 5, 'five nested levels persist and subtree returns all');
  perform tests.ok((select max(depth) from public.get_task_subtree(t1)) = 4, 'deepest level is depth 4');
  perform tests.ok((select count(*) from public.get_task_subtree(t1, 2)) = 3, 'subtree depth limit works');
  perform tests.ok((select count(*) from public.get_task_subtree(t1, 1000, 2)) = 2, 'subtree row limit works');

  -- progress: only leaf L5 exists -> 0%
  perform tests.ok((select progress_percent from public.get_task_progress(array[t1])) = 0.0, 'parent progress starts at 0%');
  -- add a second leaf at level 5; complete one of two
  insert into public.tasks (workspace_id, title, parent_task_id) values (ws, 'L5b Implement correction', t4) returning id into t5;
  update public.tasks set status = 'completed' where id = t5;
  perform tests.ok((select progress_percent from public.get_task_progress(array[t1])) = 50.0, 'completing one of two leaves gives 50% at the root');
  perform tests.ok((select progress_percent from public.get_task_progress(array[t4])) = 50.0, 'intermediate parent also 50%');
  perform tests.ok((select completed_at is not null from public.tasks where id = t5), 'completed_at set on completion');
  -- cancelling the other leaf excludes it -> 100%
  update public.tasks set status = 'cancelled' where title like 'L5 Reproduce%';
  perform tests.ok((select progress_percent from public.get_task_progress(array[t1])) = 100.0, 'cancelled leaf is excluded from progress');
  perform tests.ok((select child_count from public.task_overview where id = t4) = 2, 'child count shown in overview');
  update public.tasks set status = 'not_started' where title like 'L5 Reproduce%';
  update public.tasks set status = 'not_started', completed_at = now() where id = t5;
  perform tests.ok((select completed_at is null from public.tasks where id = t5), 'completed_at cleared when reopened');

  -- cycles
  perform tests.ok(tests.sqlstate_of(format('update public.tasks set parent_task_id = %L where id = %L', t5, t1)) = '23514', 'cycle (root under deepest descendant) is rejected');
  perform tests.ok(tests.sqlstate_of(format('update public.tasks set parent_task_id = id where id = %L', t1)) = '23514', 'task cannot be its own parent');
  perform tests.ok(tests.sqlstate_of(format('update public.tasks set parent_task_id = %L where id = %L', t3, t2)) = '23514', 'cycle via middle node rejected');

  -- cross-workspace child is rejected at commit (forced immediate here)
  perform tests.ok(tests.sqlstate_of(format($q$
      with w as (select id from public.workspaces where seed_key='keelvon')
      insert into public.tasks (workspace_id, title, parent_task_id) select w.id, 'bad child', %L from w;
      set constraints all immediate$q$, t1)) = '23514', 'subtask in a different workspace than its parent is rejected');
end $$;

-- ---------------------------------------------------------------- deadlines, overdue, history
do $$
declare ws uuid; t uuid; r public.tasks; n int;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';

  insert into public.tasks (workspace_id, title, current_deadline, status)
  values (ws, 'Overdue thing', public.user_today() - 1, 'in_progress') returning id into t;

  perform tests.ok((select original_deadline = current_deadline from public.tasks where id = t), 'original_deadline defaults to current_deadline on create');
  perform tests.ok((select is_overdue from public.task_overview where id = t), 'yesterday deadline is flagged overdue');
  perform tests.ok((select status from public.tasks where id = t) = 'in_progress', 'overdue does NOT change status');

  r := public.reschedule_task(t, public.user_today() + 3, 'waiting on merchant');
  perform tests.ok(r.original_deadline = public.user_today() - 1, 'original deadline preserved after reschedule');
  perform tests.ok(r.current_deadline = public.user_today() + 3, 'current deadline moved');
  perform tests.ok(not (select is_overdue from public.task_overview where id = t), 'no longer overdue after reschedule');

  -- a direct UPDATE cannot rewrite the original deadline either
  update public.tasks set original_deadline = public.user_today() + 10 where id = t;
  perform tests.ok((select original_deadline from public.tasks where id = t) = public.user_today() - 1, 'original_deadline is write-once');

  select count(*) into n from public.task_activity
   where task_id = t and action = 'rescheduled' and reason = 'waiting on merchant'
     and (old_value #>> '{}')::date = public.user_today() - 1
     and (new_value #>> '{}')::date = public.user_today() + 3;
  perform tests.ok(n = 1, 'reschedule recorded in history with old value, new value and reason');
  perform tests.ok((select count(*) from public.task_activity where task_id = t and action = 'created') = 1, 'creation recorded in history');

  -- history cannot be forged, edited or deleted by the user
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.task_activity (owner_id, task_id, action) values (auth.uid(), %L, 'forged')$q$, t)) = '42501', 'user cannot insert task_activity');
  perform tests.ok(tests.sqlstate_of(format($q$update public.task_activity set action='x' where task_id=%L$q$, t)) = '42501', 'user cannot update task_activity');
  perform tests.ok(tests.sqlstate_of(format($q$delete from public.task_activity where task_id=%L$q$, t)) = '42501', 'user cannot delete task_activity');
end $$;

-- ---------------------------------------------------------------- move subtree between workspaces
do $$
declare w1 uuid; w2 uuid; root uuid; kid uuid; deep uuid; te uuid;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  set local role authenticated;
  select id into w1 from public.workspaces where seed_key = 'university';
  select id into w2 from public.workspaces where seed_key = 'keelvon';
  insert into public.tasks (workspace_id, title) values (w1, 'Move root') returning id into root;
  insert into public.tasks (workspace_id, title, parent_task_id) values (w1, 'Move kid', root) returning id into kid;
  insert into public.tasks (workspace_id, title, parent_task_id) values (w1, 'Move deep', kid) returning id into deep;
  insert into public.time_entries (task_id, duration_minutes) values (deep, 30) returning id into te;
  perform tests.ok((select workspace_id from public.time_entries where id = te) = w1, 'time entry workspace derived from its task');

  perform public.move_task_to_workspace(root, w2);
  perform tests.ok((select count(*) from public.tasks where id in (root, kid, deep) and workspace_id = w2) = 3, 'moving a task moves its whole subtree');
  perform tests.ok((select workspace_id from public.time_entries where id = te) = w2, 'time entries follow moved tasks');
  perform tests.ok((select count(*) from public.task_activity where task_id = kid and field = 'workspace_id') = 1, 'workspace move recorded in history');
end $$;

-- ---------------------------------------------------------------- time entries
do $$
declare ws uuid; t uuid; id1 uuid; r record;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';
  -- "I worked two hours on Wapsi today"
  insert into public.time_entries (workspace_id, duration_minutes, source, note) values (ws, 120, 'ai', 'two hours') returning * into r;
  perform tests.ok(r.entry_date = public.user_today(), 'manual entry defaults to today in user timezone');
  perform tests.ok(tests.sqlstate_of('update public.time_entries set duration_minutes = 0') = '23514', 'zero-minute entry rejected');
  -- timers
  insert into public.time_entries (workspace_id, started_at, source) values (ws, now() - interval '45 minutes', 'timer') returning id into id1;
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.time_entries (workspace_id, started_at, source) values (%L, now(), 'timer')$q$, ws)) = '23505', 'only one running timer allowed');
  update public.time_entries set ended_at = now() where id = id1;
  perform tests.ok((select duration_minutes from public.time_entries where id = id1) between 44 and 46, 'stopping a timer computes duration');
end $$;

-- ---------------------------------------------------------------- capture + idempotency
do $$
declare cid uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  set local role authenticated;
  insert into public.quick_capture (raw_text, client_request_id, source) values ('call Nazir tomorrow', cid, 'offline_sync');
  perform tests.ok((select status from public.quick_capture where client_request_id = cid) = 'inbox', 'capture saves with no other fields and lands in inbox');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.quick_capture (raw_text, client_request_id) values ('call Nazir tomorrow', %L)$q$, cid)) = '23505', 'replayed capture (same client_request_id) is rejected as duplicate');
  perform tests.ok(tests.sqlstate_of($q$insert into public.quick_capture (raw_text) values ('   ')$q$) = '23514', 'blank capture rejected');
  insert into public.sync_queue (op_id, device_id, entity_type, operation, payload) values (cid, 'phone-1', 'quick_capture', 'create', '{}');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.sync_queue (op_id, device_id, entity_type, operation, payload) values (%L,'phone-1','quick_capture','create','{}')$q$, cid)) = '23505', 'sync op ids are unique per user');
end $$;

-- ---------------------------------------------------------------- meetings, commitments, goals, AI log
do $$
declare ws uuid; p uuid; m uuid; n int;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';
  insert into public.people (name, organization) values ('Test Person', 'Org') returning id into p;
  insert into public.meetings (workspace_id, title, starts_at, ends_at) values (ws, 'Eval meeting', now() + interval '1 day', now() + interval '1 day 1 hour') returning id into m;
  perform tests.ok((select count(*) from public.calendar_events where meeting_id = m and event_type = 'meeting' and deleted_at is null) = 1, 'meeting creates its calendar event');
  update public.meetings set starts_at = starts_at + interval '2 hours', ends_at = ends_at + interval '2 hours' where id = m;
  perform tests.ok((select count(*) from public.calendar_events where meeting_id = m) = 1, 'rescheduling a meeting updates (not duplicates) its calendar event');
  update public.meetings set status = 'cancelled' where id = m;
  perform tests.ok((select count(*) from public.calendar_events where meeting_id = m and deleted_at is null) = 0, 'cancelled meeting leaves the calendar');

  perform tests.ok(tests.sqlstate_of($q$insert into public.commitments (description) values ('Nobody promised anyone')$q$) = '23514', 'commitment with no counterparty is rejected');
end $$;

do $$
declare ws uuid; p uuid; g uuid;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';
  select id into p from public.people limit 1;
  insert into public.commitments (description, made_to_person_id) values ('Send pilot proposal', p);
  perform tests.ok((select count(*) from public.commitments where made_to_person_id = p) = 1, 'commitment to a person saves');
  insert into public.commitments (description, made_to_person_id, status) values ('Done thing', p, 'completed');
  perform tests.ok((select completed_at is not null from public.commitments where description = 'Done thing'), 'completed commitment gets completed_at');

  insert into public.goals (workspace_id, name) values (ws, 'Run 3 pilots') returning id into g;
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.milestones (goal_id, title) values (%L, 'Be awesome')$q$, g)) = '23514', 'non-measurable milestone rejected');
  insert into public.milestones (goal_id, title, target_value, current_value, unit) values (g, 'Pilot merchants live', 4, 1, 'merchants');
  insert into public.milestones (goal_id, title, measure_description, status) values (g, 'Contract signed', 'Signed PDF on file', 'achieved');
  perform tests.ok((select progress_percent from public.goal_progress where goal_id = g) = 62.5, 'goal progress averages milestones (25% + 100%)');

  -- AI action log invariants
  insert into public.ai_action_logs (tool_name, tool_kind, proposed_input, requires_confirmation, status)
  values ('delete_task', 'write', '{"id":"x"}', true, 'awaiting_approval');
  perform tests.ok(tests.sqlstate_of($q$update public.ai_action_logs set status='executed'$q$) = '23514', 'AI write cannot be recorded as executed without verification/approval');
  perform tests.ok(tests.sqlstate_of($q$update public.ai_action_logs set tool_name='something_else'$q$) = '42501', 'AI proposal fields are immutable to the user');
  perform tests.ok(tests.sqlstate_of($q$delete from public.ai_action_logs$q$) = '42501', 'AI action log cannot be deleted by the user');
  update public.ai_action_logs set status='executed', approved_at=now(), write_verified=true, executed_at=now();
  perform tests.ok((select count(*) from public.ai_action_logs where status='executed') = 1, 'verified + approved AI write can be recorded as executed');
end $$;

-- ---------------------------------------------------------------- RLS isolation (user B vs A)
do $$
declare wa uuid; ta uuid; n int; wb uuid;
begin
  select id into wa from public.workspaces where owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and seed_key = 'wapsi';
  select id into ta from public.tasks limit 1;
  select id into wb from public.workspaces where owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and seed_key = 'wapsi';

  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
  set local role authenticated;

  perform tests.ok((select count(*) from public.tasks) = 0, 'B sees none of A''s tasks');
  perform tests.ok((select count(*) from public.workspaces) = 6, 'B sees only own six workspaces');
  perform tests.ok((select count(*) from public.task_overview) = 0, 'B sees none of A''s tasks through the view');
  perform tests.ok((select count(*) from public.task_activity) = 0, 'B sees none of A''s history');
  perform tests.ok((select count(*) from public.quick_capture) = 0, 'B sees none of A''s captures');
  perform tests.ok((select count(*) from public.ai_action_logs) = 0, 'B sees none of A''s AI logs');
  perform tests.ok((select count(*) from public.profiles) = 1, 'B sees only own profile');
  perform tests.ok((select count(*) from public.workspace_members) = 6, 'B sees only own memberships');

  update public.tasks set title = 'hacked' where id = ta;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'B cannot update A''s task (0 rows affected)');
  delete from public.tasks where id = ta;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'B cannot delete A''s task');

  perform tests.ok(tests.sqlstate_of(format($q$insert into public.tasks (workspace_id, title) values (%L, 'sneaky')$q$, wa)) = '23503', 'B cannot attach a task to A''s workspace (composite FK)');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.tasks (owner_id, workspace_id, title) values (%L, %L, 'sneaky')$q$, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', wa)) = '42501', 'B cannot insert a row owned by A (RLS)');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.tasks (workspace_id, title, parent_task_id) values (%L, 'sneaky child', %L)$q$, wb, ta)) = '23503', 'B cannot parent a task under A''s task');
  perform tests.ok(tests.sqlstate_of(format($q$select public.reschedule_task(%L, current_date)$q$, ta)) = 'P0002', 'B cannot reschedule A''s task via function');
end $$;

-- anon and unauthenticated access
do $$ begin
  set local role anon;
  perform tests.ok(tests.sqlstate_of('select * from public.tasks') = '42501', 'anon has no access to tasks');
  perform tests.ok(tests.sqlstate_of('select * from public.workspaces') = '42501', 'anon has no access to workspaces');
  perform tests.ok(tests.sqlstate_of('select * from public.task_overview') = '42501', 'anon has no access to views');
  perform tests.ok(tests.sqlstate_of($q$select public.seed_default_workspaces('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$q$) = '42501', 'anon cannot call seeding function');
end $$;
do $$ begin
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
  set local role authenticated;
  perform tests.ok(tests.sqlstate_of($q$select public.seed_default_workspaces('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$q$) = '42501', 'signed-in user cannot call seeding function for someone else');
end $$;

-- ---------------------------------------------------------------- workspace rules + account deletion
do $$
declare w uuid; w2 uuid;
begin
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
  set local role authenticated;
  perform tests.ok(tests.sqlstate_of($q$insert into public.workspaces (name) values ('wapsi')$q$) = '23505', 'duplicate active workspace name rejected (case-insensitive)');
  update public.workspaces set name = 'Wapsi Labs' where seed_key = 'wapsi';
  perform tests.ok((select count(*) from public.workspaces where seed_key = 'wapsi') = 1, 'renaming keeps the seeded workspace identity');
  update public.workspaces set archived_at = now() where seed_key = 'keelvon';
  insert into public.workspaces (name) values ('KEELVON') returning id into w2;
  perform tests.ok(w2 is not null, 'name of an archived workspace can be reused');
  insert into public.workspaces (name) values ('Side Project') returning id into w;
  perform tests.ok((select count(*) from public.workspace_members where workspace_id = w and role = 'owner') = 1, 'custom workspace gets owner membership');
end $$;

-- deleting an account removes everything, including hierarchical tasks (NO ACTION parent FK)
do $$ begin
  delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  perform tests.ok((select count(*) from public.tasks where owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 0
                   and (select count(*) from public.workspaces where owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 0,
                   'deleting a user cascades through nested tasks and all owned data');
  perform tests.ok((select count(*) from public.workspaces where owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 8, 'other users'' data untouched by that deletion');
end $$;
