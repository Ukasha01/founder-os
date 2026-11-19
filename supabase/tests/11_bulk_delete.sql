-- Bulk delete + undo: soft-deletes every task titled "nn" with its subtasks in one pass, restores them, and checks isolation.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('99999999-cccc-cccc-cccc-999999999999', 'bd-a@example.com'), ('99999999-dddd-dddd-dddd-999999999999', 'bd-b@example.com') on conflict do nothing;
do $$
declare ws uuid; p1 uuid; p2 uuid; c1 uuid; g1 uuid; keep uuid; ids uuid[]; n int;
begin
  perform set_config('request.jwt.claim.sub', '99999999-cccc-cccc-cccc-999999999999', true);
  set local role authenticated;
  select id into ws from public.workspaces where seed_key = 'wapsi';
  insert into public.tasks (workspace_id, title) values (ws, 'nn') returning id into p1;
  insert into public.tasks (workspace_id, title) values (ws, 'nn') returning id into p2;
  insert into public.tasks (workspace_id, parent_task_id, title) values (ws, p1, 'child of nn') returning id into c1;
  insert into public.tasks (workspace_id, parent_task_id, title) values (ws, c1, 'grandchild') returning id into g1;
  insert into public.tasks (workspace_id, title) values (ws, 'real work') returning id into keep;

  -- the match the assistant makes (case-insensitive equality on title, open, not deleted), plus subtrees
  select array_agg(id) into ids from public.tasks where title ilike 'nn' and deleted_at is null;
  select array_agg(distinct s.id) into ids from public.get_task_subtree(p1) s;
  perform tests.ok(array_length(ids, 1) = 3, 'subtree of an nn task includes child and grandchild');
  select array_agg(id) into ids from (select id from public.tasks where title ilike 'nn' and deleted_at is null
    union select s.id from public.tasks t, lateral public.get_task_subtree(t.id) s where t.title ilike 'nn' and t.deleted_at is null) x;
  update public.tasks set deleted_at = now() where id = any(ids);
  select count(*) into n from public.tasks where id = any(ids) and deleted_at is not null;
  perform tests.ok(n = 4, 'bulk soft delete hides both nn tasks and the whole subtree');
  perform tests.ok((select deleted_at is null from public.tasks where id = keep), 'unrelated task is untouched');

  update public.tasks set deleted_at = null where id = any(ids);   -- undo
  select count(*) into n from public.tasks where id = any(ids) and deleted_at is null;
  perform tests.ok(n = 4, 'undo restores all of them');

  -- another user cannot see or delete them
  perform set_config('request.jwt.claim.sub', '99999999-dddd-dddd-dddd-999999999999', true);
  update public.tasks set deleted_at = now() where id = any(ids);
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'RLS: another account cannot touch these tasks');
end $$;
