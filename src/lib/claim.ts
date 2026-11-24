import type { SupabaseClient } from "@supabase/supabase-js";

// The reminder job runs every minute and a slow run can overlap the next one. Before a run sends anything for a reminder it "claims" it with a
// single conditional update: the update only matches if the row is still exactly as the run read it, and the database applies it to one run only.
// The run that gets a row back owns the send; any other run skips that reminder. No schema change is needed.

// First delivery or retry: moves `attempts` from the value that was read to the next one.
export async function claimDelivery(db: SupabaseClient, id: string, attempts: number): Promise<boolean> {
  const { data, error } = await db.from("reminders").update({ attempts: attempts + 1 })
    .eq("id", id).eq("status", "pending").eq("attempts", attempts).select("id");
  return !error && (data?.length ?? 0) === 1;
}

// Repeat alert: moves `nag_count` forward and schedules the next repeat in the same update. Fails if the reminder was acknowledged meanwhile.
export async function claimNag(db: SupabaseClient, id: string, nagCount: number, nextNagAt: Date | null): Promise<boolean> {
  const { data, error } = await db.from("reminders").update({ nag_count: nagCount + 1, next_nag_at: nextNagAt ? nextNagAt.toISOString() : null })
    .eq("id", id).eq("status", "sent").eq("nag_count", nagCount).is("acked_at", null).select("id");
  return !error && (data?.length ?? 0) === 1;
}
