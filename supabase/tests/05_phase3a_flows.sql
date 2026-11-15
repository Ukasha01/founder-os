-- Replays the database operations the Phase 3a screens (people, meetings, commitments) perform.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('11111111-aaaa-aaaa-aaaa-111111111111', 'p3a@example.com');
insert into auth.users (id, email) values ('22222222-aaaa-aaaa-aaaa-222222222222', 'p3a-other@example.com');
do $$
declare ws uuid; pa uuid; pb uuid; m uuid; c uuid; t uuid; other_person uuid;
begin
  perform set_config('request.jwt.claim.sub', '22222222-aaaa-aaaa-aaaa-222222222222', true);
  set local role authenticated;
  insert into public.people (name) values ('Other User Contact') returning id into other_person;
  reset role;

  perform set_config('request.jwt.claim.sub', '11111111-aaaa-aaaa-aaaa-111111111111', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';

  insert into public.people (name, organization, category) values ('Nazir', 'Pilot Merchant', 'merchant') returning id into pa;
  insert into public.people (name) values ('Sana') returning id into pb;
  perform tests.ok((select count(*) from public.people where name ilike '%naz%') = 1, 'people search by name works');
  perform tests.ok((select count(*) from public.people where name = 'Other User Contact') = 0, 'other users people are invisible');

  -- Meeting with times: calendar mirror appears, follows edits, disappears on cancel
  insert into public.meetings (title, workspace_id, starts_at, ends_at, agenda)
    values ('Pilot call', ws, now() + interval '1 day', now() + interval '1 day 1 hour', 'terms') returning id into m;
  perform tests.ok((select count(*) from public.calendar_events where meeting_id = m and deleted_at is null) = 1, 'meeting with a time appears on the calendar');
  update public.meetings set title = 'Pilot call v2', status = 'held', notes = 'agreed', decisions = 'go ahead' where id = m;
  perform tests.ok((select title from public.calendar_events where meeting_id = m) = 'Pilot call v2', 'calendar mirror follows meeting edits');
  perform tests.ok(tests.sqlstate_of(format($q$update public.meetings set ends_at = starts_at - interval '1 hour' where id = %L$q$, m)) = '23514', 'end before start is rejected');

  -- Attendees: add, duplicate rejected, cross-user person rejected
  insert into public.meeting_attendees (meeting_id, person_id) values (m, pa);
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.meeting_attendees (meeting_id, person_id) values (%L, %L)$q$, m, pa)) = '23505', 'duplicate attendee is rejected');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.meeting_attendees (meeting_id, person_id) values (%L, %L)$q$, m, other_person)) in ('23503', '42501'), 'cannot add another users contact as attendee');

  -- Commitments in both directions
  insert into public.commitments (description, made_to_person_id, due_date, meeting_id, client_request_id)
    values ('Send pricing deck', pa, public.user_today() - 1, m, gen_random_uuid()) returning id into c;
  insert into public.commitments (description, made_by_person_id, follow_up_date)
    values ('Intro to supplier', pb, public.user_today());
  perform tests.ok((select count(*) from public.commitments where made_by_person_id = pa or made_to_person_id = pa) = 1, 'person filter finds only their commitments');
  perform tests.ok(tests.sqlstate_of($q$insert into public.commitments (description) values ('me to me')$q$) = '23514', 'a commitment with no other person is rejected');
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.commitments (description, made_to_person_id) values ('x', %L)$q$, other_person)) in ('23503', '42501'), 'cannot link another users contact');

  -- Follow-up task created exactly as the screen does it; retry is idempotent
  insert into public.tasks (workspace_id, title, current_deadline, client_request_id)
    values (ws, 'Send pricing deck', public.user_today() + 1, c) returning id into t;
  update public.commitments set follow_up_task_id = t where id = c;
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.tasks (workspace_id, title, client_request_id) values (%L, 'dup', %L)$q$, ws, c)) = '23505', 'double-clicking create task cannot create two tasks');

  -- Completion stamps and clears completed_at
  update public.commitments set status = 'completed' where id = c;
  perform tests.ok((select completed_at is not null from public.commitments where id = c), 'completing sets completed_at');
  update public.commitments set status = 'in_progress' where id = c;
  perform tests.ok((select completed_at is null from public.commitments where id = c), 'reopening clears completed_at');

  -- Soft delete meeting removes calendar mirror, keeps rows
  update public.meetings set deleted_at = now() where id = m;
  perform tests.ok((select count(*) from public.calendar_events where meeting_id = m and deleted_at is null) = 0, 'deleting a meeting removes it from the calendar');
end $$;
