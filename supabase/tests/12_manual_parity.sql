-- The assistant's extra actions, replayed as the exact statements it runs, as a normal signed-in user (RLS applies).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('99999999-eeee-eeee-eeee-999999999999', 'mp-a@example.com'), ('99999999-ffff-ffff-ffff-999999999999', 'mp-b@example.com') on conflict do nothing;
do $$
declare ws uuid; ppl uuid; cm uuid; mt uuid; ev uuid; gl uuid; rule uuid; te uuid; cap uuid; hb uuid; n int; r record;
begin
  perform set_config('request.jwt.claim.sub', '99999999-eeee-eeee-eeee-999999999999', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';
  insert into public.people (name) values ('Ali Test') returning id into ppl;
  insert into public.commitments (description, made_to_person_id, due_date) values ('send pilot terms', ppl, current_date) returning id into cm;

  -- update_commitment: status + reschedule
  update public.commitments set status = 'cancelled', due_date = current_date + 3 where id = cm;
  perform tests.ok((select status = 'cancelled' and due_date = current_date + 3 from public.commitments where id = cm), 'commitment status and due date change');

  -- meeting + attendee add / remove
  insert into public.meetings (title, workspace_id, starts_at) values ('sync', ws, now() + interval '1 day') returning id into mt;
  insert into public.meeting_attendees (meeting_id, person_id) values (mt, ppl);
  perform tests.ok(exists (select 1 from public.meeting_attendees where meeting_id = mt and person_id = ppl), 'attendee added');
  delete from public.meeting_attendees where meeting_id = mt and person_id = ppl;
  perform tests.ok(not exists (select 1 from public.meeting_attendees where meeting_id = mt and person_id = ppl), 'attendee removed');

  -- delete_item (soft) for commitment, meeting, person; standalone event only (meeting mirrors are protected)
  insert into public.calendar_events (title, start_at, event_type) values ('class', now() + interval '2 day', 'other') returning id into ev;
  update public.calendar_events set deleted_at = now() where id = ev and meeting_id is null;
  perform tests.ok((select deleted_at is not null from public.calendar_events where id = ev), 'standalone event soft-deleted');
  update public.calendar_events set deleted_at = now() where meeting_id = mt and meeting_id is null;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'an event mirrored from a meeting is NOT deleted by the event path');
  update public.commitments set deleted_at = now() where id = cm;
  update public.meetings set deleted_at = now() where id = mt;
  update public.people set deleted_at = now() where id = ppl;
  perform tests.ok((select count(*) from (select deleted_at from public.commitments where id = cm union all select deleted_at from public.meetings where id = mt union all select deleted_at from public.people where id = ppl) x where deleted_at is not null) = 3, 'commitment, meeting and person soft-deleted');

  -- archive habit / workspace-style archive and inbox archive
  insert into public.habits (name, frequency_type, start_date) values ('walk', 'daily', current_date) returning id into hb;
  update public.habits set archived_at = now() where id = hb;
  perform tests.ok((select archived_at is not null from public.habits where id = hb), 'habit archived');
  insert into public.quick_capture (raw_text) values ('note x') returning id into cap;
  update public.quick_capture set status = 'archived' where id = cap;
  perform tests.ok((select status = 'archived' from public.quick_capture where id = cap), 'inbox note archived');

  -- recurring rule pause + delete detaches tasks
  insert into public.recurrence_rules (workspace_id, name, target_kind, freq, interval_count, start_date) values (ws, 'weekly x', 'task', 'weekly', 1, current_date) returning id into rule;
  update public.recurrence_rules set is_paused = true where id = rule;
  perform tests.ok((select is_paused from public.recurrence_rules where id = rule), 'recurring rule paused');
  update public.tasks set recurrence_rule_id = null, occurrence_date = null where recurrence_rule_id = rule;
  delete from public.recurrence_rules where id = rule;
  perform tests.ok(not exists (select 1 from public.recurrence_rules where id = rule), 'recurring rule deleted');

  -- timer: start, a second start is refused, stop
  insert into public.time_entries (workspace_id, started_at, source) values (ws, now(), 'timer') returning id into te;
  begin
    insert into public.time_entries (workspace_id, started_at, source) values (ws, now(), 'timer');
    raise exception 'FAIL: second timer was allowed';
  exception when unique_violation then perform tests.ok(true, 'a second running timer is refused by the database'); end;
  update public.time_entries set ended_at = now() where id = te and ended_at is null;
  perform tests.ok((select ended_at is not null from public.time_entries where id = te), 'timer stopped');

  -- another account sees and changes none of it
  perform set_config('request.jwt.claim.sub', '99999999-ffff-ffff-ffff-999999999999', true);
  update public.commitments set status = 'completed' where id = cm;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'RLS: another account cannot touch these rows');
end $$;
