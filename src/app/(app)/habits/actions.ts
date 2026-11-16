"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isDateString } from "@/lib/time";

const uuid = z.string().uuid();
function go(date: string | null, error?: string): never {
  revalidatePath("/", "layout");
  const q = new URLSearchParams();
  if (date && isDateString(date)) q.set("date", date);
  if (error) q.set("error", error);
  redirect(`/habits${q.size ? `?${q}` : ""}`);
}

export async function createHabit(formData: FormData) {
  const wd = formData.getAll("weekdays").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const p = z.object({
    name: z.string().trim().min(1, "Name is required.").max(200),
    preset: z.enum(["namaz", "quran", "exercise", "reading", "learning", "sleep"]).optional().or(z.literal("")).transform((v) => v || null),
    frequency_type: z.enum(["daily", "weekdays", "weekly_target"]),
    weekly_target: z.coerce.number().int().min(1).max(7).optional().or(z.literal("")),
    unit: z.string().trim().max(40).optional().transform((v) => v || null),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(null, p.error.issues[0].message);
  const d = p.data!;
  if (d.frequency_type === "weekdays" && !wd.length) go(null, "Choose at least one weekday.");
  const supabase = await createClient();
  const { error } = await supabase.from("habits").insert({
    name: d.name, preset: d.preset, frequency_type: d.frequency_type, unit: d.unit, start_date: d.start_date,
    weekdays: d.frequency_type === "weekdays" ? wd : null,
    weekly_target: d.frequency_type === "weekly_target" ? Number(d.weekly_target || 3) : null,
  });
  go(null, error?.message);
}

// Upsert (or clear) one day's entry. Past days are editable; nothing is locked.
export async function logHabit(formData: FormData) {
  const p = z.object({
    habit_id: uuid, entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["done", "partial", "skipped", "clear"]),
    value: z.coerce.number().min(0).max(100000).optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(null, "Invalid request.");
  const d = p.data!;
  const supabase = await createClient();
  if (d.status === "clear") {
    const { error } = await supabase.from("habit_entries").delete().eq("habit_id", d.habit_id).eq("entry_date", d.entry_date);
    go(d.entry_date, error?.message);
  }
  const { error } = await supabase.from("habit_entries").upsert(
    { habit_id: d.habit_id, entry_date: d.entry_date, status: d.status, value: d.value === "" || d.value === undefined ? null : d.value },
    { onConflict: "habit_id,entry_date" },
  );
  go(d.entry_date, error?.message);
}

export async function archiveHabit(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go(null, "Invalid habit.");
  const supabase = await createClient();
  const { error } = await supabase.from("habits").update({ archived_at: new Date().toISOString() }).eq("id", id.data!);
  go(null, error?.message);
}

// One-tap toggle from Today: done <-> cleared. No redirect; the page refreshes in place.
export async function toggleHabitToday(formData: FormData) {
  const p = z.object({ habit_id: uuid, entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), done: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return;
  const d = p.data;
  const supabase = await createClient();
  if (d.done === "true") await supabase.from("habit_entries").delete().eq("habit_id", d.habit_id).eq("entry_date", d.entry_date);
  else await supabase.from("habit_entries").upsert({ habit_id: d.habit_id, entry_date: d.entry_date, status: "done" }, { onConflict: "habit_id,entry_date" });
  revalidatePath("/", "layout");
}
