"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
function go(error?: string): never {
  revalidatePath("/", "layout");
  redirect(error ? `/kpis?error=${encodeURIComponent(error)}` : "/kpis");
}

export async function createKpi(formData: FormData) {
  const p = z.object({
    workspace_id: uuid, name: z.string().trim().min(1, "Name is required.").max(200),
    unit: z.string().trim().max(40).optional().transform((v) => v || null),
    target_value: z.coerce.number().optional().or(z.literal("")),
    direction: z.enum(["higher_is_better", "lower_is_better"]),
    period: z.enum(["day", "week", "month", "quarter", "year"]),
    aggregation: z.enum(["sum", "latest", "average"]),
    show_on_dashboard: z.string().optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(p.error.issues[0].message);
  const d = p.data!;
  const supabase = await createClient();
  const { error } = await supabase.from("kpi_definitions").insert({
    workspace_id: d.workspace_id, name: d.name, unit: d.unit, direction: d.direction, period: d.period,
    aggregation: d.aggregation, show_on_dashboard: d.show_on_dashboard === "on",
    target_value: d.target_value === "" || d.target_value === undefined ? null : d.target_value,
  });
  go(error?.message);
}

// One value per KPI per period; entering it again replaces it (history of corrections is not kept in v1).
export async function recordKpi(formData: FormData) {
  const p = z.object({
    kpi_id: uuid, period_start: date, period_end: date,
    actual_value: z.coerce.number({ message: "Enter a number." }).finite(), note: z.string().trim().max(500).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(p.error.issues[0].message);
  const d = p.data!;
  if (d.period_end < d.period_start) go("End must not be before start.");
  const supabase = await createClient();
  const { error } = await supabase.from("kpi_entries").upsert(
    { kpi_id: d.kpi_id, period_start: d.period_start, period_end: d.period_end, actual_value: d.actual_value, note: d.note || null },
    { onConflict: "kpi_id,period_start,period_end" },
  );
  go(error?.message);
}

export async function archiveKpi(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("Invalid KPI.");
  const supabase = await createClient();
  const { error } = await supabase.from("kpi_definitions").update({ archived_at: new Date().toISOString() }).eq("id", id.data!);
  go(error?.message);
}
