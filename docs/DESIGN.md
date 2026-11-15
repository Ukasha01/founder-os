# Founder OS: Design Document (first deliverable)

Status: **for owner review. No application code exists yet.** The database layer (migrations, RLS, tests) is written and verified; see `DATABASE.md`.

Sections follow the brief: **A** architecture, **B** folder structure, **E** screen map, **F** Phase 1 plan, **G** environment variables, **H** risks. (**C** schema and **D** migrations are in `DATABASE.md` and `supabase/migrations/`.) Section 0 lists decisions I need you to confirm.

---

## 0. Decisions and assumptions to confirm

Where the spec was silent or ambiguous I picked the safest option. Each is cheap to change now and expensive later.

| # | Decision | Why | Change it if... |
|---|---|---|---|
| 1 | **Parent task status is never auto-changed.** Parent *progress* is computed from leaf subtasks; the UI can suggest "all subtasks done, complete the parent?" | Spec: never silently change status. | You want parents to auto-complete. |
| 2 | **Progress = % of non-cancelled leaf tasks completed.** Cancelled tasks (and their subtrees) are excluded. | Simple, explainable, no weighting guesswork. | You want weighting by estimated time. |
| 3 | **Deletes are soft** (`deleted_at`) for tasks, captures, people, meetings, commitments, goals, events. Hard delete only on account deletion. | Audit trail, safe sync, undo. | You want true purge. |
| 4 | **`original_deadline` is write-once** in the database. Direct writes to it are silently ignored; rescheduling moves `current_deadline` and logs old/new/reason. | Spec: preserve original deadlines. | You want to be able to correct a typo in the original. |
| 5 | **Deadlines are `date` (plus optional `due_time`)**, not timestamps. | "Overdue" is unambiguous in your timezone with no midnight/DST edge cases. | You need minute-precise deadlines everywhere. |
| 6 | **Meeting times live on `meetings`**; a database trigger mirrors them into `calendar_events` so the calendar and Google export read one table. | One source of truth for time, no drift. | You prefer calendar events to own the time. |
| 7 | **Commitments: `NULL` person means "me".** "I promised Waqas" = `made_to = Waqas`; "Waqas promised me" = `made_by = Waqas`. | Matches your "who made it / who it was made to" fields. | |
| 8 | **Seven tables added beyond the spec's list**: `ai_messages`, `recurrence_rules`, `recurrence_exceptions`, `attachments`, `external_calendar_links`, `push_subscriptions`, `weekly_reviews`. | Each is required by a spec sentence (messages in conversations, per-occurrence recurrence edits, attachments, Google duplicate prevention, push, weekly review). | |
| 9 | **Week starts Monday**, default timezone **Asia/Karachi**; both editable in settings. | Common default; editable. | Tell me your working week. |
| 10 | **Server routes use the signed-in user's session (RLS applies)**; the service-role key is used only by the scheduler and backup jobs. | Even a bug in AI validation cannot read another user's rows. | |

### Questions I need answered (none blocks review)

1. **Reminder scheduler.** Vercel's free plan only allows cron jobs once per day. Reminders like "meeting in 30 minutes" need minute-level checks. Options: (a) Supabase `pg_cron` + `pg_net` calling a protected API route (free, same vendor); (b) GitHub Actions schedule (free, 5-minute granularity, can lag); (c) Vercel Pro (paid). I recommend **(a)**. Needed before Phase 5.
2. **Email provider** for reminders (Resend, Brevo, etc.). I have not verified any provider's current free quota, so I will not assume one. Needed before Phase 5.
3. **Hosting vs. commercial use.** Vercel's Hobby plan is meant for personal use; I could not confirm the exact current wording from their pages (see H). Fine for your private use now, but Wapsi team use would need re-checking or a move to Cloudflare Pages.
4. **Privacy of AI input.** Your records include meetings and promises about real people. I could not verify the current Gemini free-tier data-use terms (the official page was not reachable from my environment). Please read them before Phase 4; I will send only the minimum retrieved records to the model.

---

## A. Architecture overview

```
 Laptop / Phone (installable PWA)
 ┌───────────────────────────────────────────────────────────┐
 │ Next.js UI (React, Tailwind, shadcn/ui)                   │
 │  Dashboard · Tasks · Calendar · People · Habits · KPIs    │
 │  Quick Capture ──► IndexedDB (Dexie) ──► Sync engine      │
 │  Assistant UI (text + push-to-talk voice)                 │
 └───────────┬───────────────────────────────┬───────────────┘
             │ Supabase JS (user session/JWT) │ fetch /api/*
             ▼                                ▼
 ┌───────────────────────┐        ┌───────────────────────────────┐
 │ Supabase              │◄───────│ Next.js API routes (server)   │
 │  Postgres + RLS       │  user  │  /api/ai/chat    ──► Gemini   │
 │  Auth (email, Google) │  JWT   │  /api/sync/push               │
 │  Storage (attachments)│        │  /api/calendar/google/export  │
 └───────────▲───────────┘        │  /api/cron/* (secret-guarded) │
             │ service role,      └───────────────────────────────┘
             │ jobs only                       ▲
        pg_cron + pg_net ──────────────────────┘ (reminder scheduler)
```

### Principles that shape every module

1. **The database is the source of truth.** Business rules that must never be violated (no cycles, write-once original deadline, one running timer, owner isolation, AI writes verified) are enforced **in Postgres**, not just in the UI. They are covered by 84 automated checks.
2. **Deterministic code does the work; Gemini only interprets.** Status changes, progress, scoring, search and today's lists are plain SQL/TypeScript. Gemini turns natural language (English, Urdu, Roman Urdu) into a *proposed tool call* and phrases explanations.
3. **Gemini never touches the database.** It can only propose calls to a fixed list of tools (see AI flow). Each tool has a strict Zod schema and runs with the user's own session, so RLS still applies.
4. **The app works without AI.** Every record can be created and edited manually; if Gemini is down or the quota is exhausted the assistant shows an explicit "AI unavailable" state.
5. **Offline is scoped honestly.** v1 offline = text Quick Capture + queued changes, nothing more. Other screens say "needs connection" instead of pretending.

### AI action flow (Phase 4)

```
user text/voice ─► /api/ai/chat
  1. Retrieve minimal context (workspace names/aliases, today's date + timezone). Never the whole DB.
  2. Gemini returns a proposed tool call:  { tool, args }  (function-calling, no free text SQL)
  3. Validate: tool allow-list → Zod schema → ownership (RLS) → entity resolution
       ambiguous ("that task", two "Waqas")?  ──► ask the user to choose; do nothing
  4. READ tools: run query, return real rows; Gemini only phrases the answer from those rows
     WRITE tools: build a preview ──► auto-run low-risk (create task, log time)
                                      require approval for delete / bulk / many-row changes
  5. Execute through the same deterministic functions the UI uses
  6. READ BACK the written row; only then set write_verified = true and report success
  7. Every step recorded in ai_action_logs (proposal immutable, enforced by column grants)
```

Tool allow-list (from the spec): `get_today_tasks`, `search_tasks`, `get_overdue_tasks`, `create_task`, `create_subtask`, `update_task`, `reschedule_task`, `get_meetings`, `create_meeting`, `search_commitments`, `create_commitment`, `record_time_entry`, `get_project_kpis`, `update_kpi`, `get_weekly_review`. Delete is not in the model's tool list; deletion is only ever a UI action with confirmation.

### Offline and sync (Phase 5)

* Quick Capture writes to IndexedDB first, always, even online. A background sync pushes pending items to `/api/sync/push`.
* Each item carries a client-generated `client_request_id` (UUID). The database has unique indexes on it, so a retry or replay can never create a duplicate (tested).
* `sync_queue` on the server is an idempotency ledger (unique `op_id` per user) that also records conflicts. Rows have a `version` counter; an edit made from a stale version is flagged `conflict` and kept for the user to resolve, never overwritten or dropped.
* Items stay in IndexedDB until the server confirms them. A failed sync shows its error and retries.

### Time and timezone

All "today", "overdue" and daily-score boundaries are computed in the user's timezone (`user_settings.timezone`) using `user_today()` in SQL and the same zone in TypeScript. Timestamps are stored in UTC.

### Security model

* Supabase Auth (email/password, Google, password recovery). Row Level Security on every table; `anon` has no privileges at all.
* Composite foreign keys `(child_id, owner_id)` make it impossible to link a row to another user's row, even with a forged id.
* Audit tables (`task_activity`, `ai_action_logs`) cannot be edited or deleted by the user; history is written by `SECURITY DEFINER` triggers.
* `service_role` key, `GEMINI_API_KEY`, VAPID private key and OAuth secrets exist only in server environment variables. Nothing secret is prefixed `NEXT_PUBLIC_`.
* Future Wapsi collaboration: `workspace_members` and `workspaces.is_private` already exist. Sharing later means adding member-based policies to workspace-scoped tables; personal workspaces stay private.

### Stack (as specified, no changes proposed)

Next.js (App Router) + React + TypeScript, Tailwind, shadcn/ui, Supabase (Postgres, Auth, Storage), `@supabase/ssr` for cookie sessions, Dexie for IndexedDB, Zod for validation, Vitest + Playwright for tests, `@google/genai` for Gemini, `web-push` for push, GitHub, Vercel. I see no concrete reason to deviate. One note on hosting is in H.

---

## B. Folder and file structure

```
founder-os/
├─ README.md                    install, configure, migrate, deploy
├─ .env.example                 every variable, with phase and "server only" markers
├─ package.json  tsconfig.json  next.config.ts  vitest.config.ts  playwright.config.ts
├─ components.json              shadcn/ui config
├─ public/
│  ├─ manifest.webmanifest      PWA manifest
│  ├─ icons/                    192, 512, maskable
│  └─ sw.js                     service worker (app shell cache; Phase 5: capture sync, push)
├─ supabase/
│  ├─ config.toml               local Supabase CLI config
│  ├─ migrations/               0001…0009 (written, tested)
│  └─ tests/                    00_stub_supabase.sql, 01_tests.sql, 02_perf_smoke.sql
├─ docs/                        DESIGN.md, DATABASE.md, TESTING.md (later)
├─ tests/
│  ├─ unit/                     domain logic (scoring, recurrence, progress helpers)
│  ├─ integration/              against local Supabase: RLS with two users, API routes
│  └─ e2e/                      Playwright: desktop + 375px mobile
└─ src/
   ├─ middleware.ts             session refresh + route protection
   ├─ app/
   │  ├─ (auth)/                login, signup, forgot-password, reset-password
   │  ├─ auth/callback/route.ts OAuth + email-link exchange
   │  ├─ (app)/                 authenticated shell (nav, Quick Capture button)
   │  │  ├─ page.tsx            Home dashboard
   │  │  ├─ inbox/  tasks/  tasks/[id]/  calendar/  time/
   │  │  ├─ workspaces/  workspaces/[slug]/{overview,tasks,goals,kpis,meetings,notes,activity,settings}
   │  │  ├─ people/  meetings/  commitments/  goals/  habits/  kpis/
   │  │  ├─ review/{daily,weekly}/
   │  │  ├─ assistant/  notifications/  settings/{account,workspaces,scoring,dashboard,notifications,data}
   │  └─ api/
   │     ├─ ai/chat/  ai/actions/[id]/{approve,reject}/
   │     ├─ sync/push/  calendar/google/{connect,export}/
   │     ├─ cron/reminders/     guarded by CRON_SECRET
   │     └─ backup/export/
   ├─ components/
   │  ├─ ui/                    shadcn primitives
   │  └─ shell/ capture/ tasks/ dashboard/ calendar/ people/ habits/ kpis/ assistant/
   └─ lib/
      ├─ supabase/              browser, server, middleware clients
      ├─ db/                    typed query functions (one file per module)
      ├─ types/database.ts      generated from the schema
      ├─ domain/                pure logic: tasks, scoring, streaks, recurrence, time
      ├─ ai/                    gemini client, tool registry, zod schemas, validator, prompts
      ├─ offline/               dexie db, capture queue, sync engine, conflict handling
      ├─ notifications/         scheduler, web-push, email adapter
      └─ calendar/google.ts     one-way export with duplicate prevention
```

Rule: UI components never call Gemini or the service-role client. Anything the AI can do goes through `lib/db` + `lib/domain`, the same functions the UI uses.

---

## E. Screen-by-screen application map

Navigation: **mobile** = bottom bar (Home, Tasks, Calendar, Inbox, More) + floating Quick Capture button; **desktop** = left sidebar (workspaces listed) + top bar with Quick Capture and assistant. Quick Capture is reachable from every screen.

| Screen | Route | Purpose / key content | Phase |
|---|---|---|---|
| Sign in / sign up | `/login`, `/signup` | Email+password, Google | 1 |
| Forgot / reset password | `/forgot-password`, `/reset-password` | Recovery email flow | 1 |
| **Home** | `/` | Greeting + date, workspace cards; later: top 3 priorities, due today, overdue, meetings, commitments, score, planned vs actual hours, KPIs, habits, weekly snapshot. Show/hide, reorder, compact/expanded, choose workspaces | 1 (foundation) → 2–3 fills widgets |
| Workspaces list | `/workspaces` | Six defaults + create, rename, archive, restore | 1 |
| Workspace home | `/workspaces/[slug]` | Overview; tabs: Tasks, Goals, KPIs, Meetings, Notes, Activity, Settings | 1 (shell) → 2–3 |
| Quick Capture | global sheet | Type picker (11 types), text, optional fields; works offline | 2 (offline 5) |
| Inbox | `/inbox` | Triage: assign workspace, priority, deadline, convert to task, add subtasks, attach to meeting, archive, delete with confirmation | 2 |
| Tasks | `/tasks` | Cross-workspace list/tree, filters, expand/collapse levels, child counts, progress, overdue highlight | 2 |
| Task detail | `/tasks/[id]` | All fields, subtasks, time entries, notes, attachments, history (incl. deadline changes), move workspace | 2 |
| Calendar | `/calendar` | Day / Week / Month / Agenda; time blocks; overload warning | 2 |
| Time tracking | `/time` | Timer, manual entry, today/week totals | 2 |
| Goals | `/goals` | Goals with measurable milestones and progress | 2 |
| People | `/people` | Contacts, category, workspace, notes, history with them | 3 |
| Meetings | `/meetings`, detail | Agenda, notes, decisions, attendees, follow-up tasks | 3 |
| Commitments | `/commitments` | Promised-by/to, due, follow-up, status; filter by person | 3 |
| Habits | `/habits` | Today's habits, streaks, weekly consistency, history; custom habits | 3 |
| KPIs | `/kpis` | Per-workspace KPIs, entries, history, targets | 3 |
| Daily review | `/review/daily` | Plan, score with per-category breakdown, reflections | 3 |
| Weekly review | `/review/weekly` | Week summary, wins, challenges, next-week focus | 3 |
| Assistant | `/assistant` + global panel | Chat, push-to-talk, previews, approvals, action history | 4 |
| Notifications | `/notifications` | In-app feed, mark read | 5 |
| Settings | `/settings/*` | Account, workspaces, timezone/week start, scoring weights, dashboard, notification rules, calendar export, data export/backup | 1 (account) → 5 |

---

## F. Phase 1 implementation plan

**Goal (from the spec):** you can sign in, access your private dashboard and navigate your six workspaces.

| Step | Work | Verified by |
|---|---|---|
| 1.1 | Scaffold Next.js + TS + Tailwind + shadcn/ui; lint, typecheck, Vitest, Playwright wired up | `npm run lint && npm run typecheck && npm test` green |
| 1.2 | Local Supabase via CLI; apply migrations `0001–0009`; generate `database.ts`; document hosted-project setup | Migrations apply to a clean DB; types compile |
| 1.3 | Auth: email/password sign-up/in/out, Google OAuth, password recovery, `middleware.ts` route protection, OAuth/email callback | Sign-up creates profile + settings + **six workspaces**; unauthenticated visit to `/` redirects; recovery email flow completes |
| 1.4 | App shell: responsive navigation (bottom bar / sidebar), account menu, loading + error states, accessible landmarks and focus handling | Playwright at 375px and 1280px; keyboard navigation works |
| 1.5 | Workspaces: list, detail shell with empty tabs, create / rename / archive / restore with validation (duplicate names, archived reuse) | Changes persist after refresh; second test user cannot see them |
| 1.6 | Home dashboard foundation: greeting, date in user timezone, workspace cards, widget layout stored in `user_settings.dashboard_layout`. **Only widgets that have real data are shown;** the rest appear in Phase 2/3 | Layout change persists after refresh |
| 1.7 | PWA shell: manifest, icons, service worker caching the app shell only (no data caching in Phase 1), install prompt | Lighthouse PWA/installability check; installs on desktop Chrome and Android |
| 1.8 | Integration tests (two users, RLS through the real client), e2e happy path | CI-style run output reported |
| 1.9 | README, `.env.example`, Vercel deployment steps | Fresh-clone setup followed end to end |

**Not in Phase 1:** Quick Capture, Inbox, tasks, calendar, AI, offline sync, notifications. The Quick Capture button is not shown until it works.

At the end of the phase I will report **completed / incomplete / untested** separately, as required.

---

## G. Environment variables

Copy `.env.example` to `.env.local`. Never commit real values. Variables marked **server** must never use the `NEXT_PUBLIC_` prefix.

| Variable | Scope | Phase | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | 1 | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | 1 | Public client key. Safe only because RLS is on. (Supabase has been renaming this key; use whichever your dashboard labels as the public/anon key.) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server** | 5 | Bypasses RLS. Scheduler and backup jobs only. |
| `NEXT_PUBLIC_APP_URL` | public | 1 | Used for auth redirects |
| Google sign-in client ID/secret | Supabase dashboard | 1 | Configured in Supabase Auth settings, not in the app |
| `GEMINI_API_KEY` | **server** | 4 | From Google AI Studio |
| `GEMINI_MODEL` | **server** | 4 | Model name kept configurable because Gemini model names and free-tier availability change |
| `AI_DAILY_REQUEST_CAP` | **server** | 4 | Self-imposed cap so you hit your own limit before Google's |
| `CRON_SECRET` | **server** | 5 | Shared secret protecting `/api/cron/*` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | public / **server** | 5 | Generated locally with `web-push generate-vapid-keys` |
| `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` | **server** | 5 | Provider not yet chosen (see question 2) |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` | **server** | 5 | Separate Google Cloud OAuth client with the Calendar scope |
| `TOKEN_ENCRYPTION_KEY` | **server** | 5 | Encrypts stored Google refresh tokens |

I will never invent or hard-code credentials. Until a value is supplied, the matching feature reports "not configured" instead of appearing to work.

---

## H. Risks, limitations and free-tier dependencies

**Verified from official pages on 14 Nov 2026**

* **Supabase Free**: 500 MB database, 1 GB file storage, **projects pause after 1 week of inactivity**, **no automatic backups**, 2 active projects. Consequences: you must use the app (or ping it) at least weekly, and **Founder OS will include its own export/backup (Phase 5)**; do not rely on Supabase for backups. ([Supabase pricing](https://supabase.com/pricing.md))
* **Vercel Hobby cron**: once per day, run time within a one-hour window, deploy fails on more frequent schedules. This is why reminders need a different scheduler (question 1). ([Vercel docs](https://vercel.com/docs/cron-jobs/usage-and-pricing))
* **Vercel Hobby limits** include 1M function invocations and 4 CPU-hours per month, far above personal use. ([Vercel Hobby](https://vercel.com/docs/plans/hobby))

**Not verified (please check before relying on them)**

* **Vercel Hobby commercial use.** My understanding is that Hobby is for personal, non-commercial use. The pages I could read did not state it, so I cannot quote it. Check Vercel's Terms before Wapsi team use.
* **Gemini free-tier limits and data-use terms.** The official rate-limit page was not reachable from my environment. Limits and which models are free change often; I keep the model name in config and add my own request cap. Treat free-tier prompts as potentially used by Google until you have read the terms.
* **iOS push.** From my knowledge, web push on iPhone works only for a PWA installed to the Home Screen on a recent iOS version. I will test on a real device in Phase 5 rather than assume it.

**Technical risks and how the design handles them**

| Risk | Mitigation |
|---|---|
| Push and email "work" in code but never arrive | Needs VAPID keys, user permission, a running scheduler and an email provider. I will report each as *configured / not configured* and test delivery end to end; no claim without a received message. |
| Offline conflicts across two devices | Row `version` + `sync_queue` conflict status; conflicts are surfaced, never auto-overwritten. |
| Gemini misreads Roman Urdu | Ambiguity → ask; consequential writes → preview; all proposals logged. I will build a small test set of real phrases from your examples and report accuracy honestly. |
| Quota exhausted mid-day | Explicit "AI unavailable" state; everything else keeps working. |
| Large task lists | Progress is computed only for visible tasks; measured on 15,000 tasks: progress for 50 visible tasks ≈ 5 ms, for 3,000 roots ≈ 48 ms. |
| Google Calendar duplicates | Unique keys on `(event, calendar)` and `(calendar, external_event_id)` plus a content hash. |
| Browser speech recognition missing or weak for Urdu | Push-to-talk uses the browser's built-in recognition "where available" (as your spec says); the text path always works. Quality for Urdu varies by browser and must be tested. |
| Account/credential ownership | Repo, Supabase, Gemini key and hosting all under your accounts; I deliver files only. |

**Limitations of this working environment.** I build and test in a sandbox that cannot reach your Supabase project or sign in to your Google/Vercel accounts. I can run the database layer against a real local PostgreSQL (done) and the app against local Supabase if available; anything requiring your live accounts (Google OAuth, push to your phone, deployment) is something I will give you steps for and you will confirm, and I will mark it **untested by me** until you do.
