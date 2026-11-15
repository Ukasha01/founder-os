-- 0009_rls_and_grants.sql
-- Row Level Security + least-privilege grants.
--
-- Model (v1, single private user): every row carries owner_id and a user can only see and
-- touch rows where owner_id = auth.uid(). Composite foreign keys (child_id, owner_id) in the
-- table definitions additionally guarantee a row can never link to another user's row.
--
-- anon gets nothing. The service_role key (server-only, used for the notification scheduler
-- and backups) bypasses RLS by design and must never reach the browser.

-- 1) Start from zero privileges, then grant back only what is needed.
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

-- Future objects created by migrations should not be auto-exposed either.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to authenticated;

-- 2) Standard owner-scoped tables: full CRUD on own rows.
do $$
declare
  t text;
  owner_tables text[] := array[
    'user_settings', 'workspaces', 'recurrence_rules', 'recurrence_exceptions',
    'tasks', 'tags', 'task_tags', 'task_comments', 'time_entries',
    'goals', 'milestones', 'calendar_events', 'external_calendar_links',
    'people', 'meetings', 'meeting_attendees', 'commitments', 'attachments',
    'habits', 'habit_entries', 'kpi_definitions', 'kpi_entries',
    'daily_reviews', 'weekly_reviews',
    'quick_capture', 'reminders', 'notifications', 'push_subscriptions', 'sync_queue',
    'ai_conversations', 'ai_messages'
  ];
begin
  foreach t in array owner_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using (owner_id = (select auth.uid()))$p$, t || '_select_own', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
                      with check (owner_id = (select auth.uid()))$p$, t || '_insert_own', t);
    execute format($p$create policy %I on public.%I for update to authenticated
                      using (owner_id = (select auth.uid()))
                      with check (owner_id = (select auth.uid()))$p$, t || '_update_own', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
                      using (owner_id = (select auth.uid()))$p$, t || '_delete_own', t);
  end loop;
end $$;

-- 3) profiles: keyed by id, not owner_id. Read and update own; created by trigger only.
alter table public.profiles enable row level security;
grant select, update (display_name, avatar_url, onboarding_completed_at) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- 4) workspace_members: read-only for the member. v1 has no UI to invite anyone;
--    rows are created only by the SECURITY DEFINER trigger on workspaces.
alter table public.workspace_members enable row level security;
grant select on public.workspace_members to authenticated;
create policy workspace_members_select_own on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()));

-- 5) task_activity: append-only, written by a SECURITY DEFINER trigger. Users can read only.
alter table public.task_activity enable row level security;
grant select on public.task_activity to authenticated;
create policy task_activity_select_own on public.task_activity for select to authenticated
  using (owner_id = (select auth.uid()));

-- 6) ai_action_logs: readable, insertable, and only the lifecycle columns are updatable.
--    The model's original proposal (tool_name, proposed_input, ...) can never be rewritten,
--    and rows can never be deleted by the user.
alter table public.ai_action_logs enable row level security;
grant select, insert on public.ai_action_logs to authenticated;
grant update (status, validated_input, preview, result, error, write_verified,
              affected_entity_type, affected_entity_ids, approved_at, executed_at)
  on public.ai_action_logs to authenticated;
create policy ai_action_logs_select_own on public.ai_action_logs for select to authenticated
  using (owner_id = (select auth.uid()));
create policy ai_action_logs_insert_own on public.ai_action_logs for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy ai_action_logs_update_own on public.ai_action_logs for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- 7) Views run with the caller's rights (security_invoker) so RLS on the base tables applies.
grant select on public.task_overview, public.goal_progress to authenticated;

-- 8) Functions callable by a signed-in user. Everything else (seeding, triggers) is internal.
grant execute on function public.user_today()                         to authenticated;
grant execute on function public.is_valid_timezone(text)              to authenticated;
grant execute on function public.is_valid_scoring_weights(jsonb)      to authenticated;
grant execute on function public.get_task_subtree(uuid, integer, integer) to authenticated;
grant execute on function public.get_task_progress(uuid[])            to authenticated;
grant execute on function public.reschedule_task(uuid, date, text)    to authenticated;
grant execute on function public.move_task_to_workspace(uuid, uuid, uuid) to authenticated;
