-- Replays the database operations the Phase 4 assistant performs, and the safety rules around them.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('55555555-dddd-dddd-dddd-555555555555', 'p4a@example.com'), ('66666666-eeee-eeee-eeee-666666666666', 'p4b@example.com');
do $$
declare ws uuid; c uuid; m uuid; l uuid; l2 uuid; t uuid; n int; st text;
begin
  perform set_config('request.jwt.claim.sub', '55555555-dddd-dddd-dddd-555555555555', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';

  insert into public.ai_conversations (title) values ('Assistant') returning id into c;
  insert into public.ai_messages (conversation_id, role, content, input_mode) values (c, 'user', 'add task call courier', 'text');
  insert into public.ai_messages (conversation_id, role, content, model) values (c, 'assistant', 'Here is what I would do:', 'gemini-2.5-flash') returning id into m;
  insert into public.ai_action_logs (conversation_id, message_id, tool_name, tool_kind, proposed_input, validated_input, preview, status, idempotency_key)
    values (c, m, 'create_task', 'write', '{"title":"Call courier","workspace":"wapsi"}', jsonb_build_object('title','Call courier','workspace_id',ws), '{"text":"Create task"}', 'awaiting_approval', m || ':0') returning id into l;

  -- approval is a lock: only one click can move awaiting_approval -> executing
  update public.ai_action_logs set status = 'executing', approved_at = now() where id = l and status = 'awaiting_approval';
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'first approval takes the lock');
  update public.ai_action_logs set status = 'executing', approved_at = now() where id = l and status = 'awaiting_approval';
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'second approval click does nothing');

  -- the write: idempotent through client_request_id = action id
  insert into public.tasks (workspace_id, title, client_request_id) values (ws, 'Call courier', l) returning id into t;
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.tasks (workspace_id, title, client_request_id) values (%L, 'Call courier', %L)$q$, ws, l)) = '23505', 'replaying the same approval cannot create a second task');

  -- cannot claim executed without a read-back verification
  perform tests.ok(tests.sqlstate_of(format($q$update public.ai_action_logs set status = 'executed' where id = %L$q$, l)) = '23514', 'executed requires write_verified');
  update public.ai_action_logs set status = 'executed', write_verified = true, affected_entity_type = 'task', affected_entity_ids = array[t], executed_at = now() where id = l;
  perform tests.ok((select status from public.ai_action_logs where id = l) = 'executed', 'verified write recorded as executed');

  -- the model's proposal and the log itself are immutable / permanent
  perform tests.ok(tests.sqlstate_of(format($q$update public.ai_action_logs set proposed_input = '{}' where id = %L$q$, l)) = '42501', 'proposal cannot be rewritten');
  perform tests.ok(tests.sqlstate_of(format($q$delete from public.ai_action_logs where id = %L$q$, l)) = '42501', 'action log cannot be deleted');

  -- reject path and approval-required constraint
  insert into public.ai_action_logs (conversation_id, message_id, tool_name, tool_kind, proposed_input, status, idempotency_key)
    values (c, m, 'add_to_inbox', 'write', '{"text":"x"}', 'awaiting_approval', m || ':1') returning id into l2;
  update public.ai_action_logs set status = 'rejected' where id = l2 and status = 'awaiting_approval';
  perform tests.ok((select status from public.ai_action_logs where id = l2) = 'rejected', 'skipping marks the action rejected');
  update public.ai_action_logs set status = 'executing', approved_at = now() where id = l2 and status = 'awaiting_approval';
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a skipped action cannot be approved afterwards');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.ai_action_logs (conversation_id, message_id, tool_name, tool_kind, proposed_input, status, idempotency_key) values (%L, %L, 'x', 'write', '{}', 'proposed', %L)$q$, c, m, m || ':1')) = '23505', 'same proposal cannot be logged twice');

  -- other tool writes the executor performs
  insert into public.quick_capture (raw_text, capture_type, source, client_request_id) values ('I promised Ali a demo', 'promise', 'ai', l2);
  perform tests.ok((select count(*) from public.quick_capture where source = 'ai') = 1, 'assistant inbox capture stored with source ai');
  insert into public.time_entries (task_id, workspace_id, duration_minutes, source, client_request_id) values (t, ws, 45, 'manual', gen_random_uuid());
  perform tests.ok((select sum(duration_minutes) from public.time_entries where task_id = t) = 45, 'assistant time log stored');
  perform public.reschedule_task(t, public.user_today() + 3, 'Moved by assistant');
  perform tests.ok((select current_deadline from public.tasks where id = t) = public.user_today() + 3, 'assistant reschedule works through the same RPC');
  update public.tasks set status = 'completed' where id = t;
  perform tests.ok((select status from public.tasks where id = t) = 'completed', 'assistant completion works');
end $$;

-- another user can see none of it
do $$
begin
  perform set_config('request.jwt.claim.sub', '66666666-eeee-eeee-eeee-666666666666', true);
  set local role authenticated;
  perform tests.ok((select count(*) from public.ai_action_logs) = 0, 'other user sees no action logs');
  perform tests.ok((select count(*) from public.ai_messages) = 0, 'other user sees no assistant messages');
end $$;
