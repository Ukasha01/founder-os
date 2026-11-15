# Founder OS: Database design (deliverables C and D)

Migrations live in `supabase/migrations/` and are applied in order. They were applied to a clean PostgreSQL 16 server and exercised by `supabase/tests/01_tests.sql` (84 checks, all passing).

## Migration order

| File | Contents |
|---|---|
| `0001_base.sql` | Enums (task status/priority, capture type/status), `set_updated_at`, `touch_versioned`, timezone validator |
| `0002_identity_workspaces.sql` | `profiles`, `user_settings`, `workspaces`, `workspace_members`; `user_today()`; first-login seeding of profile, settings and the six workspaces |
| `0003_ai.sql` | `ai_conversations`, `ai_messages`, `ai_action_logs` |
| `0004_recurrence_tasks.sql` | `recurrence_rules/_exceptions`, `tasks`, `tags`, `task_tags`, `task_comments`, `task_activity`, `time_entries`; all task triggers; `get_task_subtree`, `get_task_progress`, `task_overview`, `reschedule_task`, `move_task_to_workspace` |
| `0005_planning.sql` | `goals`, `milestones`, `goal_progress`, `calendar_events`, `external_calendar_links` |
| `0006_people_meetings_commitments.sql` | `people`, `meetings` (+ calendar mirror trigger), `meeting_attendees`, `commitments`, `attachments` |
| `0007_habits_kpis_reviews.sql` | `habits`, `habit_entries`, `kpi_definitions`, `kpi_entries`, `daily_reviews`, `weekly_reviews` |
| `0008_capture_notifications_sync.sql` | `quick_capture`, `reminders`, `notifications`, `push_subscriptions`, `sync_queue` |
| `0009_rls_and_grants.sql` | RLS on every table, policies, least-privilege grants, function execute rights |

## Tables and relationships

All tables carry `owner_id` (default `auth.uid()`, cascades on account deletion) except `profiles` (keyed by `id`) and `workspace_members` (keyed by `user_id`).

```
auth.users ─┬─ profiles (1:1)           ─ user_settings (1:1: timezone, weights, layout, prefs)
            └─ workspaces ──┬─ workspace_members (future collaboration)
                            ├─ tasks ──(parent_task_id)──► tasks          unlimited nesting
                            │    ├─ task_activity   (append-only history)
                            │    ├─ task_comments, task_tags ─ tags, attachments
                            │    ├─ time_entries    (workspace derived from task)
                            │    └─ calendar_events (optional time block)
                            ├─ goals ─ milestones
                            ├─ kpi_definitions ─ kpi_entries
                            ├─ habits ─ habit_entries
                            ├─ people ─ meeting_attendees ─ meetings ─► calendar_events (mirror)
                            ├─ commitments ──► people (by / to), meetings, follow-up task
                            ├─ recurrence_rules ─ recurrence_exceptions ─► materialised tasks/events
                            └─ quick_capture (Inbox)
 reminders ─► notifications          push_subscriptions          sync_queue
 ai_conversations ─ ai_messages      ai_action_logs ─► task_activity.ai_action_id
 daily_reviews, weekly_reviews       external_calendar_links ─► calendar_events
```

Beyond the spec's table list I added: `ai_messages`, `recurrence_rules`, `recurrence_exceptions`, `attachments`, `external_calendar_links`, `push_subscriptions`, `weekly_reviews` (see DESIGN.md decision 8).

## Rules enforced by the database

| Rule (from the spec) | Mechanism | Tested |
|---|---|---|
| Unlimited nesting, no arbitrary depth limit | self-referencing `parent_task_id`; `get_task_subtree` takes optional depth/row limits (defaults 1000 / 10,000) | 5 levels, depth and row limits |
| No circular parents, no self-parent | `prevent_task_cycle` trigger with per-user advisory lock (concurrent moves cannot jointly make a cycle) | direct, middle-node and self cases |
| Subtask in same workspace as parent | deferred constraint trigger, checked on the **final** state at commit | rejected case + whole-subtree move |
| Move task between workspaces keeps history | `move_task_to_workspace` moves the whole subtree and its time entries atomically | yes |
| Parent completion from children | `get_task_progress(ids[])`: % of non-cancelled leaves completed; cancelled excluded | 0%, 50%, 100%, cancelled |
| Overdue never changes status/deadline | `is_overdue` is derived in `task_overview`; no trigger touches `status` based on dates | yes |
| Original deadline preserved | write-once in `tasks_before_write`; `reschedule_task` moves `current_deadline` | direct overwrite attempt ignored |
| Deadline history | `log_task_changes` (SECURITY DEFINER) records old/new value, reason, source, AI action | yes; users cannot insert/update/delete history |
| Duplicate prevention for retries | unique `(owner_id, client_request_id)` on captures, tasks, time entries, events, commitments, KPI entries; unique `(owner_id, op_id)` on `sync_queue` | captures and sync ops |
| One running timer | partial unique index | yes |
| Milestones measurable | CHECK: numeric target or a written measure | yes |
| Scoring weights editable but sum to 100 | CHECK on `user_settings.scoring_weights` | yes |
| Missing KPI data is not zero | no row = no data; `kpi_entries` has no default value | by design (scoring logic comes in Phase 3) |
| Habits: a missed day is recoverable | past entries editable; `skipped` is an excused status; streaks computed in code | by design (Phase 3) |
| Recurring: one occurrence edit must not change the series | occurrences are materialised as ordinary rows; per-occurrence overrides live in `recurrence_exceptions`; unique `(rule, date, index)` | schema only (generator is Phase 3) |
| Google export without duplicates | unique `(event, provider, calendar)` and `(provider, calendar, external_event_id)` | schema only (Phase 5) |
| AI never reports an unverified write | CHECK: an executed write needs `write_verified = true` | yes |
| AI confirmation for risky actions | CHECK: `requires_confirmation` rows cannot reach `executing/executed` without `approved_at` | yes |
| AI proposals tamper-proof | column-level UPDATE grants: tool name and proposed input are immutable; no DELETE | yes |

## Row Level Security

* `anon` role: **no privileges** on any table, view or internal function (tested).
* `authenticated`: every table is `owner_id = auth.uid()` for select/insert/update/delete, except:
  * `profiles`: own row; only `display_name`, `avatar_url`, `onboarding_completed_at` updatable.
  * `workspace_members`: read-only (v1 has no invitations).
  * `task_activity`: read-only.
  * `ai_action_logs`: read, insert, and update of lifecycle columns only.
* Composite foreign keys `(x_id, owner_id)` stop a user from referencing another user's row even with a guessed id (tested for workspaces and parent tasks).
* Views use `security_invoker`, so they inherit table RLS (tested).
* Seeding functions are internal; neither `anon` nor signed-in users can execute them (tested).

## What is NOT covered yet (so nothing is overstated)

* Streak, weekly-consistency, daily-score and recurrence-generation **logic** are not written (Phases 3).
* Supabase **Storage** bucket and its policies for attachments are not created (Phase 2).
* Backup/export and restore (Phase 5).
* RLS was tested on plain PostgreSQL 16 with a small stand-in for Supabase's `auth` schema (`tests/00_stub_supabase.sql`), including the same default grants Supabase applies. It has **not** been run against a real Supabase project; I will re-run the suite there when you create the project (it only needs the SQL editor or CLI).
* Only `get_task_progress` was performance-tested at scale (15,000 tasks, 5 levels): 50 visible tasks ≈ 5 ms, 3,000 root tasks ≈ 48 ms, subtree lookup ≈ 3 ms, title search ≈ 8 ms.
* Supabase may use a newer or older Postgres major version than the 16 I tested. `ON DELETE SET NULL (column)` needs PostgreSQL 15 or newer.

## Running the tests locally

```bash
# Needs a local PostgreSQL (any version >= 15) and a throwaway database.
createdb fos_test
psql -d fos_test -v ON_ERROR_STOP=1 -f supabase/tests/00_stub_supabase.sql   # test harness ONLY, never on Supabase
for f in supabase/migrations/*.sql; do psql -d fos_test -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -d fos_test -v ON_ERROR_STOP=1 -q -f supabase/tests/01_tests.sql        # expect 84 'PASS' notices, no ERROR
psql -d fos_test -q -f supabase/tests/02_perf_smoke.sql                      # optional timings
```

`01_tests.sql` creates a `tests` schema; recreate the database before running it again.
