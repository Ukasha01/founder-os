import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "./time";
import { occurrences, withoutExceptions, type Rule, type Exception } from "./recurrence";

// Creates task rows for the next `horizon` days from every active recurring rule. Idempotent: existing
// (rule, date, index) rows and skipped/rescheduled occurrences are never recreated, so a completed or
// individually rescheduled occurrence is never touched. Past days are never back-filled.
export async function materializeRecurring(supabase: SupabaseClient, today: string, horizon = 14): Promise<number> {
  const { data: rules } = await supabase.from("recurrence_rules").select("*").eq("target_kind", "task").eq("is_paused", false);
  if (!rules?.length) return 0;
  const to = addDays(today, horizon);
  const ids = rules.map((r) => r.id);
  const [{ data: ex }, { data: existing }] = await Promise.all([
    supabase.from("recurrence_exceptions").select("rule_id, occurrence_date, occurrence_index, kind").in("rule_id", ids).gte("occurrence_date", today).lte("occurrence_date", to),
    supabase.from("tasks").select("recurrence_rule_id, occurrence_date, occurrence_index").in("recurrence_rule_id", ids).gte("occurrence_date", today).lte("occurrence_date", to),
  ]);
  const have = new Set((existing ?? []).map((t) => `${t.recurrence_rule_id}#${t.occurrence_date}#${t.occurrence_index}`));
  const rows: Record<string, unknown>[] = [];
  for (const r of rules) {
    const rule: Rule = { ...r, times_of_day: r.times_of_day?.map((t: string) => t.slice(0, 5)) ?? null };
    const exc = ((ex ?? []).filter((e) => e.rule_id === r.id) as (Exception & { rule_id: string })[]);
    for (const o of withoutExceptions(occurrences(rule, today, to), exc)) {
      if (have.has(`${r.id}#${o.date}#${o.index}`)) continue;
      const t = (r.template ?? {}) as { title?: string; priority?: string; estimated_minutes?: number };
      rows.push({
        workspace_id: r.workspace_id, title: `${t.title ?? r.name}${o.time ? ` (${o.time})` : ""}`.slice(0, 500),
        priority: t.priority ?? "normal", estimated_minutes: t.estimated_minutes ?? null,
        current_deadline: o.date, source: "recurrence", recurrence_rule_id: r.id, occurrence_date: o.date, occurrence_index: o.index,
      });
    }
  }
  let created = 0;
  for (const row of rows) { // one by one so a race on the unique index only skips that row
    const { error } = await supabase.from("tasks").insert(row);
    if (!error) created++;
  }
  return created;
}
