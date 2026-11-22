# Founder OS: what to do, step by step

Your app: https://founder-os-gilt-iota.vercel.app
Code: https://github.com/Ukasha01/founder-os (every push to `main` redeploys automatically)

## A. One-time setup (about 20 minutes)

1. **Supabase sign-in links.** Supabase dashboard → Authentication → URL Configuration. Set *Site URL* to the app address above, and add `https://founder-os-gilt-iota.vercel.app/auth/callback` under *Redirect URLs*. Without this, Google sign-in and password-reset emails send you to the wrong place.
2. **Switch on the assistant.** Get a free key at Google AI Studio. In Vercel → project `founder-os` → Settings → Environment Variables, add `GEMINI_API_KEY` (Production). Redeploy. Never paste the key into chat or into the code.
3. **Switch on reminders.** In the same Vercel screen add:
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API (the *service_role* key; keep it secret, never share it).
   - `CRON_SECRET`: any long random string (run `openssl rand -hex 32`).
   Redeploy. Vercel then calls the reminder job once a day (08:00 Karachi) by itself.
4. **Phone notifications (optional).** On any computer run `npx web-push generate-vapid-keys`. Add `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:your-email`) in Vercel. Redeploy. Then on your phone open Settings → Notifications → *Turn on notifications on this device*.
5. **Install on your phone.** Open the app in Chrome (Android) or Safari (iPhone) → Share/menu → *Add to Home Screen*. On iPhone, notifications only work from the installed app.

## B. Daily use (keep it small)

- **Morning:** open **Today**. Tick off what's done; tick habits as you do them.
- **Anything on your mind:** tap **Capture**. Don't decide where it goes. Sort the **Inbox** once a day.
- **Something to do:** **Tasks** → *New task*. Open a task only when you need subtasks, a new deadline or time.
- **Talk to it:** **Today → Assistant**: "Add a task in Wapsi to call the courier by Friday". Check the preview, press *Approve*.
- **Evening:** **Today → Review** (two minutes).
- **Once a week:** Plan → Goals/KPIs, and the weekly review.

## C. Look after your data

- **Settings → Download backup (JSON)** every week or two. Supabase Free has no automatic backups.
- **Settings → Download calendar (.ics)** to bring events and deadlines into Google Calendar (one-way).
- Supabase Free pauses a project after a week with no use; opening the app regularly prevents that.

## D. Test checklist (tick each, tell me what fails)

1. Sign in with email and with Google.
2. Capture a note → it appears in Inbox → turn it into a task.
3. Turn on airplane mode → Capture a note → turn it off → it appears in the Inbox within a minute.
4. Create a task with a subtask, tick it done from the list, move its deadline.
5. Habits: tick one on Today; check the streak in Plan → Habits.
6. Assistant (after step A2): propose, approve, and skip an action; confirm the task exists.
7. Settings: both downloads work and open.
8. After A3: open `/api/cron/reminders` with the secret to see `{"ok":true,...}`, or wait for the next morning and check Today for a Reminders card.

## E. Known limits (honest list)

- Reminders run once a day on Vercel's free plan. For meeting reminders within the hour, add a free Supabase pg_cron job that calls `/api/cron/reminders` every 5 minutes with your `CRON_SECRET`.
- Offline works for Quick Capture only, not for editing tasks.
- Google Calendar is a file import, not a live two-way sync. No email reminders yet.
- Gemini's free limits and Vercel's non-commercial Hobby terms should be checked by you before relying on them for the business.
- Sign-in screens still have the old plain look; screens are good but not best yet. That polish pass is next.

## Voice assistant (Urdu, always listening)

1. Open the app on Android Chrome and tap the round mic button once. Allow the microphone. From then on the app starts listening by itself when you open it (Chrome only lets a page do that after you have allowed the mic once). Tap the button to turn it off.
2. Just talk, in Urdu, English or mixed. It waits through pauses (about 1.5 seconds of silence ends your sentence), understands you with Gemini, and answers by voice.
3. Say "ruk jao", "bas", "stop" or "chup" while it speaks and it stops at once. Starting a new sentence also interrupts it.
4. When it proposes a change, say "haan" to approve or "nahi" to skip. Deletions are never approved by voice; confirm those on screen. Or turn on Auto-approve in the Assistant screen.
5. Voice out: add `ELEVENLABS_API_KEY` (best quality, limited free characters) or rely on the Gemini voice (uses `GEMINI_API_KEY`). If neither speaks Urdu well, replies still appear as text.
6. Limits: it only listens while the app is open on screen. Each sentence you speak uses Gemini requests (understand, think, speak), so the free daily limit goes faster than with typing.

### Faster and with more free allowance (do this once)

Gemini's free allowance is small and its answers are slower. Add a free Groq key and the assistant answers in about a second, and Gemini becomes the backup when either one hits its limit.

1. Go to console.groq.com, sign in, create an API key (no card needed).
2. In Vercel: your project, Settings, Environment Variables, add `GROQ_API_KEY`, then redeploy.
3. Optional: a second free fast provider, `CEREBRAS_API_KEY` from cloud.cerebras.ai.

What the voice assistant can read now: tasks (with notes, subtasks, comments, history), Inbox, calendar events, meetings, time logged, daily reviews, recurring rules, goals, habits, KPIs, people, commitments, performance, and a search across all of them. It can change things only through the approval flow.

## Deleting many tasks, and undo
- Say "delete all tasks named nn" (English, Roman Urdu or Urdu). The assistant makes one confirmation: "DELETE N tasks titled “nn” (and their subtasks)". Reply "yes" / "haan" / "ہاں" to confirm, or "no" / "نہیں" to skip. Your answer is handled by the app itself, so it is instant and consistent.
- Deleting is a soft delete, and "undo" / "undo that delete" restores the latest delete within 7 days.
- Bulk actions: delete, complete or cancel, matched by title (exact or contains) and optionally a workspace; maximum 500 tasks per request.
- The assistant's replies about changes are built from what the app actually did, so they cannot claim something that did not happen.

## Voice and echo (important)
- While the assistant is speaking, the microphone is not listened to. This is deliberate: it makes it impossible for the assistant to hear its own voice (a problem on laptop speakers). Use the **Stop** button to interrupt. It listens again about a second after it finishes.
- "Voice interrupt" (button next to the mic) lets you say "ruk jao" while it talks. Turn it on only with a headset.
- Speech recognition drops sounds it is unsure about, and ignores Korean/Chinese/Russian guesses, instead of passing guesses to the assistant.

## What the assistant can do (same as you can by hand)
Tasks (create, edit, complete, reschedule, move, delete, bulk delete/complete/cancel, undo delete), goals and milestones, habits, KPIs, people, meetings (and attendees), commitments (status, dates), calendar events, recurring tasks (create, pause/resume, delete), work timers (start/stop), workspaces (create/rename/archive), inbox notes (add/archive/delete), daily reviews, time logging.
- Anything that deletes or archives always asks you first, even with auto-approve on. Everything is checked in the database after it runs.
- Not available to the assistant: Settings (capacity, weights, notifications) and account/security changes. Those stay manual on purpose.

## Urdu voice on every browser
Replies are spoken by (1) the browser's own Urdu voice if it has one (Edge, most Android phones), otherwise by the server: ElevenLabs if `ELEVENLABS_API_KEY` is set, then Microsoft's free neural voice, then Gemini. The Microsoft voice uses an unofficial route and may stop working; ElevenLabs is the reliable one. Set the key in Vercel → Project → Settings → Environment Variables, then redeploy.

## Voice speed and diagnosis
- Open `/api/voice/diag` (signed in) to see the models/voices in use and LLM timings; add `?speak=1` to also time real speech (uses ~50 ElevenLabs characters).
- Browser console shows `[timing]` lines: speech-to-text, assistant turn (LLM ms), each speech chunk (server ms, provider) and when playback started.
- Providers that just failed are skipped for 30-300 s (circuit breaker), so one dead provider no longer adds a timeout to every reply.

## Telegram backup for reminders
Some phones (Xiaomi/MIUI) block browser push while idle. Telegram is a second channel that reaches a locked phone.
1. In Telegram open @BotFather, send `/newbot`, pick a name and a username ending in `bot`, copy the token it gives you.
2. In Vercel > Project > Settings > Environment Variables add `TELEGRAM_BOT_TOKEN` (value = that token), then redeploy.
3. Founder OS > Settings > Telegram backup > Connect. Open your bot in Telegram, press Start, send the 8-character code. Press "Send test".
Every reminder is then sent to Telegram as well as to browsers.
