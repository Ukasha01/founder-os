import { createClient } from "@/lib/supabase/server";
import { input, card } from "@/lib/ui";
import { DEFAULT_WEIGHTS, type Weights } from "@/lib/score";
import { saveGeneral, saveWeights, addNote, deleteNote } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { PushToggle } from "./push-toggle";
import { TelegramLink, EmailBackup, GoogleCalendarCard } from "./telegram-link";
import { tgToken } from "@/lib/telegram";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: s } = await supabase.from("user_settings").select("timezone, week_starts_on, scoring_weights").maybeSingle();
  const { data: notes } = await supabase.from("assistant_notes").select("id, note").order("created_at", { ascending: false }).limit(50);
  const w = (s?.scoring_weights as Weights | undefined) ?? DEFAULT_WEIGHTS;
  const fields: [keyof Weights, string][] = [["tasks", "Tasks completed"], ["hours", "Planned hours worked"], ["kpis", "KPIs"], ["habits", "Habits"], ["planning", "Planning and review"]];
  return (
    <div className="max-w-2xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Settings</h1>
      {sp.error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}
      {sp.saved && <p role="status" className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-800">{sp.saved}</p>}
      <form action={saveGeneral} className={`${card} mt-4 grid gap-2 sm:grid-cols-2`}>
        <h2 className="font-medium sm:col-span-2">General</h2>
        <label className="flex flex-col gap-1 text-xs">Timezone<input name="timezone" defaultValue={s?.timezone ?? "Asia/Karachi"} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Week starts on
          <select name="week_starts_on" defaultValue={String(s?.week_starts_on ?? 1)} className={input}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        </label>
        <div><SubmitButton variant="primary">Save</SubmitButton></div>
      </form>
      <form action={saveWeights} className={`${card} mt-4 grid gap-2 sm:grid-cols-2`}>
        <h2 className="font-medium sm:col-span-2">Daily score weights (must add up to 100)</h2>
        {fields.map(([k, label]) => <label key={k} className="flex flex-col gap-1 text-xs">{label}<input type="number" name={k} min={0} max={100} step="any" defaultValue={w[k]} className={input} /></label>)}
        <div><SubmitButton variant="primary">Save weights</SubmitButton></div>
      </form>
      <section className={`${card} mt-4`}>
        <h2 className="font-medium">What the assistant knows about you</h2>
        <p className="mt-1 mb-3 text-sm text-neutral-600">Short facts it uses in every chat. It can propose new ones (you approve them). Delete anything that is wrong.</p>
        <ul className="flex flex-col gap-1.5">
          {(notes ?? []).map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">{n.note}</span>
              <form action={deleteNote}><input type="hidden" name="id" value={n.id} /><SubmitButton>Delete</SubmitButton></form>
            </li>
          ))}
          {!notes?.length && <li className="text-sm text-neutral-500">Nothing yet. Tell the assistant something lasting, like when you sleep, or add a note here.</li>}
        </ul>
        <form action={addNote} className="mt-3 flex gap-2">
          <input name="note" maxLength={300} placeholder="e.g. I usually sleep after 1 am" className={`${input} flex-1`} />
          <SubmitButton variant="primary">Add</SubmitButton>
        </form>
      </section>
      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Notifications</h2>
        <p className="mt-1 mb-3 text-sm text-neutral-600">A daily summary of what is due, meetings starting within the hour, and commitments to follow up. They always appear on the Today screen; this also sends them to your phone.</p>
        <PushToggle publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null} />
      </section>
      {tgToken() && (
        <section className={`${card} mt-4`}>
          <h2 className="font-medium">Telegram backup</h2>
          <p className="mt-1 mb-3 text-sm text-neutral-600">Some phones block browser notifications when idle. Telegram reaches a locked phone reliably, so reminders are also sent there.</p>
          <TelegramLink />
        </section>
      )}
      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Email backup (no VPN needed)</h2>
        <p className="mt-1 mb-3 text-sm text-neutral-600">Reminders you set, meetings and timed tasks are also emailed to your account address, so Gmail alerts your phone even when browser push is blocked.</p>
        <EmailBackup />
      </section>
      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Google Calendar alerts</h2>
        <p className="mt-1 mb-3 text-sm text-neutral-600">Reminders you set and tasks with a due time are mirrored to your Google Calendar with a pop-up alert (Karachi time), as an extra way to be reminded.</p>
        <GoogleCalendarCard />
      </section>
      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Your data</h2>
        <p className="mt-1 text-sm text-neutral-600">Your data is yours. Download a full copy at any time, or take your calendar into Google Calendar.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/export" className="inline-flex items-center rounded-[10px] bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:brightness-110">Download backup (JSON)</a>
          <a href="/api/calendar" className="inline-flex items-center rounded-[10px] border border-line-strong px-4 py-2 text-sm font-medium hover:bg-tint">Download calendar (.ics)</a>
        </div>
        <p className="mt-2 text-xs text-neutral-500">The calendar file holds events and open task deadlines. In Google Calendar choose Settings, then Import &amp; export, then Import. It is a one-way copy; changes made in Google do not come back.</p>
      </section>
    </div>
  );
}
