# Founder OS

A private personal operating system (tasks with unlimited subtasks, meetings, commitments, habits, KPIs, daily score) with an AI executive assistant. Installable PWA for laptop and phone. Built to run on free tiers.

**Current status: database layer, Phases 1, 2 and 3.** See `docs/DESIGN.md` (architecture, screens, Phase 1 plan, risks) and `docs/DATABASE.md` (schema and rules).

| Component | State |
|---|---|
| Database migrations `0001–0009` with RLS | Written; applied to PostgreSQL 16 (84 automated checks pass) **and applied to a live Supabase project** (Nov 2026): seeding of six workspaces, deadline history, append-only activity log, cross-user and anon isolation confirmed there with a rolled-back test; Supabase security advisor reported no issues. The app itself has still not been run against it |
| Phase 1 part 1: Next.js app, email/password + Google sign-in, password recovery, protected routes, dashboard, workspaces (create/rename/archive/restore), installable PWA shell | Written; builds and lints clean; routes smoke-tested **without** Supabase keys. **Not yet tested against a live Supabase project** (sign-in, workspace persistence, Google login) |
| Phase 2: Quick Capture, Inbox triage, tasks with unlimited subtasks, status/priority/estimate, reschedule with history, move workspace, soft delete, start/stop timer and manual time logging, goals with measurable milestones, calendar (day/week/month/agenda) with events, task deadlines and working-hours overload warnings, dashboard widgets | Written; builds and lints clean; timezone helpers unit-tested; all database operations these screens use replayed against PostgreSQL (`supabase/tests/03_*` and `04_*`, 27 checks pass). **Not yet clicked through against a live Supabase project.** Gaps: drag-and-drop calendar editing, editing existing events, recurring items (Phase 3) |
| Phase 3: people, meetings (agenda/notes/decisions/attendees, mirrored on the calendar), commitments (both directions, follow-up task), habits (streaks, consistency, skipped = excused), KPIs (missing data shown as "no data"), daily score with a transparent breakdown and editable weights, daily and weekly review, recurring tasks (daily/weekly/monthly, several per day, pause/resume, skip one occurrence), settings, dashboard widgets | Written; builds and lints clean; habit, score and recurrence logic unit-tested (`npm run test:unit`); database operations replayed against PostgreSQL (`supabase/tests/05_*`, `06_*`, `07_*`, 36 checks pass). **Not yet clicked through against a live Supabase project.** Gaps: Inbox converts only to tasks (meeting/promise captures are not converted yet), custom (RFC 5545) recurrence rules, editing a past KPI entry keeps no correction history, recurring tasks are created only when the app is opened (a scheduled job comes in Phase 5), KPI period ratios for the score use only entries whose period covers that day |
| Phase 4: Gemini assistant (Assistant tab). Six allow-listed actions (create task/subtask, complete, reschedule, log time, add to Inbox; no delete). Every action is validated server-side, shown as a preview, runs only after you tap Approve, and is read back from the database before it is recorded as done. Full audit in `ai_action_logs`. English, Urdu and Roman Urdu. Daily cap (`AI_DAILY_REQUEST_CAP`). If Gemini is over quota or down, the screen says so and offers to save your message to the Inbox | Written; builds and lints clean; tool validation and response parsing unit-tested; the database operations (approval lock, idempotency, verified writes, immutable log, isolation) replayed against PostgreSQL (`supabase/tests/08_*`, 16 checks pass). **Not tested against the real Gemini API yet**: it needs your `GEMINI_API_KEY`. Model defaults to `gemini-2.5-flash`; set `GEMINI_MODEL` if Google renames it. Free-tier limits are unverified. Gaps: no voice input, no commitment creation (needs a person link; use Inbox), one conversation at a time |
| Offline sync, notifications, Google export, backup (Phase 5) | Not started |

## What you own

Your GitHub repository, Supabase project, Google AI Studio key and hosting account. No secret lives in this repo; copy `.env.example` to `.env.local` and fill it in.

## Setting up the database (works today)

1. Create a Supabase project (free plan) under your own account.
2. In the Supabase **SQL Editor**, run each file in `supabase/migrations/` in numeric order (`0001` … `0009`). Or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.
3. Sign up a test user (Authentication > Users > Add user). Confirm in **Table Editor > workspaces** that six workspaces were created for that user automatically.
4. Optional: verify the rules on a scratch PostgreSQL by following "Running the tests locally" in `docs/DATABASE.md`. **Never run `supabase/tests/00_stub_supabase.sql` on your Supabase project.**

## Free-tier cautions

* Supabase Free pauses a project after one week of inactivity and does not include automatic backups; a Founder OS export/backup feature is planned for Phase 5.
* Vercel Hobby cron jobs run at most once per day, so minute-level reminders need a different scheduler (see `docs/DESIGN.md`, question 1).

## Roadmap

Phase 1 Foundation → 2 Daily operating system → 3 Founder and personal management → 4 AI assistant → 5 Reliability and deployment. One phase is built, tested and reported (completed / incomplete / untested) before the next begins.

## Run the app locally

```bash
npm install
cp .env.example .env.local     # fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev                    # http://localhost:3000
```

In Supabase: Authentication > URL Configuration, add `http://localhost:3000/auth/callback` to the redirect URLs.
Google sign-in only works after you enable the Google provider in Supabase (Authentication > Providers).
The service worker only registers in production builds (`npm run build && npm start`) and caches nothing yet.
