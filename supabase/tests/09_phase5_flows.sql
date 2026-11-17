-- Replays the database operations Phase 5 uses from the app: notifications, push subscriptions, reminder de-duplication.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('77777777-aaaa-aaaa-aaaa-777777777777', 'p5a@example.com'), ('88888888-bbbb-bbbb-bbbb-888888888888', 'p5b@example.com');
do $$
declare r uuid; n int;
begin
  perform set_config('request.jwt.claim.sub', '77777777-aaaa-aaaa-aaaa-777777777777', true);
  set local role authenticated;

  -- reminders de-duplicate by key (what keeps a 5-minute job from repeating itself)
  insert into public.reminders (title, kind, remind_at, dedupe_key, channels) values ('2 tasks due today', 'deadline', now(), 'digest:2026-11-20', array['in_app','push']) returning id into r;
  perform tests.ok(tests.sqlstate_of($q$insert into public.reminders (title, kind, remind_at, dedupe_key) values ('again', 'deadline', now(), 'digest:2026-11-20')$q$) = '23505', 'same reminder cannot be planned twice');
  perform tests.ok(tests.sqlstate_of($q$insert into public.reminders (title, kind, remind_at, channels) values ('x', 'custom', now(), array['sms'])$q$) = '23514', 'unknown channel rejected');

  -- in-app notification, read marking
  insert into public.notifications (reminder_id, kind, title, link) values (r, 'deadline', '2 tasks due today', '/');
  perform tests.ok((select count(*) from public.notifications where read_at is null) = 1, 'unread notification visible');
  update public.notifications set read_at = now() where read_at is null;
  perform tests.ok((select count(*) from public.notifications where read_at is null) = 0, 'mark all read works');

  -- push subscription upsert by endpoint (re-subscribing the same device keeps one row), then unsubscribe
  insert into public.push_subscriptions (endpoint, p256dh, auth_secret, device_label) values ('https://push.example/abc', 'k1', 'a1', 'phone')
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, device_label = excluded.device_label;
  insert into public.push_subscriptions (endpoint, p256dh, auth_secret, device_label) values ('https://push.example/abc', 'k2', 'a2', 'phone')
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, device_label = excluded.device_label;
  perform tests.ok((select count(*) from public.push_subscriptions) = 1 and (select p256dh from public.push_subscriptions) = 'k2', 're-subscribing a device keeps one row with the new keys');
  delete from public.push_subscriptions where endpoint = 'https://push.example/abc';
  perform tests.ok((select count(*) from public.push_subscriptions) = 0, 'unsubscribing removes the device');
  insert into public.push_subscriptions (endpoint, p256dh, auth_secret) values ('https://push.example/owner-a', 'k', 'a');
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '88888888-bbbb-bbbb-bbbb-888888888888', true);
  set local role authenticated;
  perform tests.ok((select count(*) from public.reminders) = 0 and (select count(*) from public.notifications) = 0 and (select count(*) from public.push_subscriptions) = 0, 'other user sees none of these rows');
  perform tests.ok(tests.sqlstate_of($q$insert into public.notifications (owner_id, kind, title) values ('77777777-aaaa-aaaa-aaaa-777777777777', 'x', 'forged')$q$) = '42501', 'cannot write a notification for another user');
  perform tests.ok(tests.sqlstate_of($q$update public.push_subscriptions set p256dh = 'stolen' where endpoint = 'https://push.example/owner-a'$q$) is null or (select count(*) from public.push_subscriptions) = 0, 'cannot touch another user''s push subscription');
end $$;
