-- Replays database operations the Phase 3c screens (recurring tasks, daily/weekly reviews, settings) perform.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('44444444-cccc-cccc-cccc-444444444444', 'p3c@example.com');
do $$
declare ws uuid; r uuid; t uuid; n int; w jsonb;
begin
  perform set_config('request.jwt.claim.sub', '44444444-cccc-cccc-cccc-444444444444', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';

  insert into public.recurrence_rules (workspace_id, name, target_kind, freq, interval_count, start_date, template)
    values (ws, 'Check orders', 'task', 'daily', 1, public.user_today(), '{"title":"Check orders"}') returning id into r;
  insert into public.tasks (workspace_id, title, source, recurrence_rule_id, occurrence_date, occurrence_index, current_deadline)
    values (ws, 'Check orders', 'recurrence', r, public.user_today(), 0, public.user_today()) returning id into t;
  perform tests.ok(tests.sqlstate_of(format($q$insert into public.tasks (workspace_id, title, source, recurrence_rule_id, occurrence_date, occurrence_index) values (%L, 'dup', 'recurrence', %L, public.user_today(), 0)$q$, ws, r)) = '23505', 'the same occurrence cannot be generated twice');
  insert into public.tasks (workspace_id, title, source, recurrence_rule_id, occurrence_date, occurrence_index)
    values (ws, 'Check orders (18:00)', 'recurrence', r, public.user_today(), 1);
  perform tests.ok((select count(*) from public.tasks where recurrence_rule_id = r) = 2, 'several occurrences per day are allowed (different index)');

  -- rescheduling one occurrence leaves the series and siblings alone
  perform public.reschedule_task(t, public.user_today() + 3, 'busy');
  perform tests.ok((select count(*) from public.tasks where recurrence_rule_id = r and current_deadline = public.user_today() + 3) = 1, 'only that occurrence moved');
  perform tests.ok((select freq from public.recurrence_rules where id = r) = 'daily', 'series unchanged by rescheduling one occurrence');

  -- skip one occurrence: exception recorded (upsert twice is safe), task cancelled
  insert into public.recurrence_exceptions (rule_id, occurrence_date, occurrence_index, kind) values (r, public.user_today() + 1, 0, 'skipped')
    on conflict (rule_id, occurrence_date, occurrence_index) do update set kind = excluded.kind;
  insert into public.recurrence_exceptions (rule_id, occurrence_date, occurrence_index, kind) values (r, public.user_today() + 1, 0, 'skipped')
    on conflict (rule_id, occurrence_date, occurrence_index) do update set kind = excluded.kind;
  perform tests.ok((select count(*) from public.recurrence_exceptions where rule_id = r) = 1, 'skipping the same occurrence twice keeps one exception');

  -- pause / resume
  update public.recurrence_rules set is_paused = true where id = r;
  update public.recurrence_rules set is_paused = false where id = r;
  perform tests.ok(not (select is_paused from public.recurrence_rules where id = r), 'pause and resume round-trip');

  -- delete rule: created tasks are detached first and kept
  update public.tasks set recurrence_rule_id = null, occurrence_date = null where recurrence_rule_id = r;
  delete from public.recurrence_rules where id = r;
  perform tests.ok((select count(*) from public.tasks where title like 'Check orders%') = 2, 'deleting a rule keeps the tasks it created');

  -- daily review: plan then complete with a frozen score snapshot; re-save updates, never duplicates
  insert into public.daily_reviews (review_date, plan_completed_at) values (public.user_today(), now())
    on conflict (owner_id, review_date) do update set plan_completed_at = excluded.plan_completed_at;
  insert into public.daily_reviews (review_date, wins, review_completed_at) values (public.user_today(), 'shipped', now())
    on conflict (owner_id, review_date) do update set wins = excluded.wins, review_completed_at = excluded.review_completed_at;
  update public.daily_reviews set score_total = 72.5, score_breakdown = '{"tasks":{"points":30}}', weights_snapshot = '{"tasks":40,"hours":20,"kpis":15,"habits":15,"planning":10}'
    where review_date = public.user_today();
  perform tests.ok((select count(*) from public.daily_reviews) = 1 and (select plan_completed_at is not null and wins = 'shipped' and score_total = 72.5 from public.daily_reviews), 'plan then complete merge into one review row with the score snapshot');
  perform tests.ok(tests.sqlstate_of($q$update public.daily_reviews set score_total = 150$q$) = '23514', 'score above 100 rejected');

  -- weekly review upsert
  insert into public.weekly_reviews (week_start, wins) values (public.user_today(), 'a')
    on conflict (owner_id, week_start) do update set wins = excluded.wins;
  insert into public.weekly_reviews (week_start, wins, summary, completed_at) values (public.user_today(), 'b', '{"tasks_completed":3}', now())
    on conflict (owner_id, week_start) do update set wins = excluded.wins, summary = excluded.summary, completed_at = excluded.completed_at;
  perform tests.ok((select count(*) from public.weekly_reviews) = 1 and (select wins from public.weekly_reviews) = 'b', 'weekly review saves once per week');

  -- settings: weights must add to 100 (the DB enforces what the form checks)
  update public.user_settings set scoring_weights = '{"tasks":50,"hours":20,"kpis":10,"habits":10,"planning":10}' where owner_id is not null;
  select scoring_weights into w from public.user_settings;
  perform tests.ok((w->>'tasks')::int = 50, 'valid custom weights are saved');
  perform tests.ok(tests.sqlstate_of($q$update public.user_settings set scoring_weights = '{"tasks":50,"hours":20,"kpis":10,"habits":10,"planning":20}'$q$) = '23514', 'weights not adding to 100 are rejected');
  perform tests.ok(tests.sqlstate_of($q$update public.user_settings set timezone = 'Mars/Base'$q$) = '23514', 'invalid timezone rejected');
end $$;
