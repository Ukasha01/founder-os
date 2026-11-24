// Email backup for reminders, through Resend's HTTP API (free tier; no extra package). Gmail alerts reach a locked phone reliably
// and need no VPN. Without RESEND_API_KEY nothing is sent.
export const emailOn = () => !!process.env.RESEND_API_KEY;

export async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY; if (!key) return { ok: false, error: "RESEND_API_KEY is not set." };
  const from = process.env.REMINDER_EMAIL_FROM || "Founder OS <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(8000) });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: `Resend HTTP ${r.status}: ${j.message ?? "no details"}` };
  } catch { return { ok: false, error: "Could not reach Resend." }; }
}
