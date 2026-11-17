import { createClient } from "@/lib/supabase/server";
import { card, input, badge } from "@/lib/ui";
import { SubmitButton } from "@/components/submit-button";
import { askAssistant, approveAction, rejectAction, newChat, saveToInbox } from "./actions";

type Msg = { id: string; role: string; content: string | null; created_at: string };
type Log = { id: string; message_id: string | null; tool_name: string; status: string; preview: { text?: string } | null; error: string | null };

const STATUS: Record<string, { label: string; cls: string }> = {
  awaiting_approval: { label: "Needs your approval", cls: "bg-amber-100 text-amber-800" },
  executed: { label: "Done", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Skipped", cls: "bg-neutral-100 text-neutral-500" },
  failed: { label: "Not done", cls: "bg-rose-100 text-rose-800" },
  executing: { label: "Running", cls: "bg-sky-100 text-sky-800" },
};

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const configured = !!process.env.GEMINI_API_KEY;
  const { data: conv } = await supabase.from("ai_conversations").select("id").is("archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const [{ data: msgs }, { data: logs }] = conv ? await Promise.all([
    supabase.from("ai_messages").select("id, role, content, created_at").eq("conversation_id", conv.id).order("created_at"),
    supabase.from("ai_action_logs").select("id, message_id, tool_name, status, preview, error").eq("conversation_id", conv.id).order("created_at"),
  ]) : [{ data: [] }, { data: [] }];
  const byMsg = new Map<string, Log[]>();
  for (const l of (logs ?? []) as Log[]) if (l.message_id) byMsg.set(l.message_id, [...(byMsg.get(l.message_id) ?? []), l]);
  const lastUser = [...((msgs ?? []) as Msg[])].reverse().find((m) => m.role === "user")?.content ?? "";
  const lastWasSystem = (msgs as Msg[] | null)?.at(-1)?.role === "system";

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Assistant</h1>
          <p className="text-sm text-neutral-500">Tell it what you want in English, Urdu or Roman Urdu. It proposes changes; nothing happens until you approve.</p>
        </div>
        {(msgs?.length ?? 0) > 0 && <form action={newChat}><SubmitButton>New chat</SubmitButton></form>}
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {!configured && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">The assistant is not switched on yet: no Gemini key is set. Everything else in the app works normally.</p>}

      <div className="mt-5 flex flex-col gap-3">
        {!msgs?.length && (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface/60 p-6 text-sm text-neutral-600">
            <p className="font-medium text-ink">Try saying</p>
            <ul className="mt-2 list-disc pl-5">
              <li>Add a task in Wapsi to follow up with the courier partner by Friday</li>
              <li>Move my report task to next Monday</li>
              <li>Maine 45 minutes Wapsi demo pe kaam kiya (log 45 minutes)</li>
              <li>Mark the pitch deck task as done</li>
            </ul>
          </div>
        )}
        {((msgs ?? []) as Msg[]).map((m) => (
          <div key={m.id} className={m.role === "user" ? "self-end max-w-[85%]" : "max-w-[92%]"}>
            {m.role === "system" ? (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{m.content}</p>
            ) : (
              <p className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] ${m.role === "user" ? "bg-ink text-white" : "border border-line bg-surface"}`}>{m.content}</p>
            )}
            {byMsg.get(m.id)?.map((l) => {
              const st = STATUS[l.status] ?? STATUS.failed;
              return (
                <div key={l.id} className={`${card} mt-2 flex flex-wrap items-center gap-3 !p-3`}>
                  <span className={`${badge} ${st.cls}`}>{st.label}</span>
                  <span className="min-w-0 flex-1 text-sm">{l.preview?.text ?? l.error ?? l.tool_name}</span>
                  {l.status === "failed" && l.error && l.preview && <span className="w-full text-xs text-rose-700">{l.error}</span>}
                  {l.status === "awaiting_approval" && (
                    <span className="flex gap-2">
                      <form action={approveAction}><input type="hidden" name="id" value={l.id} /><SubmitButton variant="primary">Approve</SubmitButton></form>
                      <form action={rejectAction}><input type="hidden" name="id" value={l.id} /><SubmitButton>Skip</SubmitButton></form>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {lastWasSystem && lastUser && (
          <form action={saveToInbox} className="flex items-center gap-3 text-sm">
            <input type="hidden" name="text" value={lastUser} />
            <SubmitButton>Save my last message to Inbox</SubmitButton>
          </form>
        )}
      </div>

      <form action={askAssistant} className="sticky bottom-20 mt-6 flex gap-2 rounded-2xl border border-line bg-surface p-2 shadow-pop md:bottom-4">
        <input name="message" required maxLength={2000} autoComplete="off" placeholder={configured ? "What should I do?" : "Assistant is not switched on yet"} disabled={!configured}
          className={`${input} min-w-0 flex-1 border-0 focus:ring-0`} aria-label="Message the assistant" />
        <SubmitButton variant="primary">Send</SubmitButton>
      </form>
    </div>
  );
}
