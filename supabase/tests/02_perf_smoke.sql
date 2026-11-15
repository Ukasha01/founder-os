-- Large-list smoke test: 30,000 tasks (3,000 trees x 10 nodes, 5 levels deep) for one user.
-- Run after the migrations on a database that has at least one user. Reports timings only.
\timing on
do $$
declare uid uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd'; ws uuid;
begin
  insert into auth.users (id, email) values (uid, 'perf@example.com') on conflict do nothing;
  select id into ws from public.workspaces where owner_id = uid and seed_key = 'wapsi';
  -- level 1 roots
  insert into public.tasks (owner_id, workspace_id, title)
    select uid, ws, 'root ' || g from generate_series(1, 3000) g;
  -- each subsequent level adds one child per node of previous level, with extra siblings at L3
  for lvl in 2..5 loop
    insert into public.tasks (owner_id, workspace_id, title, parent_task_id, status)
      select t.owner_id, t.workspace_id, 'child L' || lvl || ' of ' || t.title, t.id,
             case when random() < 0.4 then 'completed'::public.task_status else 'not_started' end
      from public.tasks t
      where t.owner_id = uid and t.title like case lvl when 2 then 'root %' else 'child L' || (lvl - 1) || ' %' end;
  end loop;
  raise notice 'tasks inserted: %', (select count(*) from public.tasks where owner_id = uid);
end $$;
analyze public.tasks;
set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
\echo -- task_overview rows for the workspace (no progress)
select count(*) from public.task_overview;
\echo -- progress for 50 visible root tasks (what a list screen needs)
select count(*), round(avg(progress_percent),1) from public.get_task_progress(
  (select array_agg(id) from (select id from public.tasks where parent_task_id is null order by id limit 50) x));
\echo -- progress for ALL 3,000 root tasks (worst case)
select count(*), round(avg(progress_percent),1) from public.get_task_progress(
  (select array_agg(id) from public.tasks where parent_task_id is null));
\echo -- single subtree
select count(*) from public.get_task_subtree((select id from public.tasks where title = 'root 1'));
\echo -- overdue filter
select count(*) from public.task_overview where is_overdue;
\echo -- title search
select count(*) from public.tasks where title ilike '%root 15%';
