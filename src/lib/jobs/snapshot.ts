import "server-only";
import type { Db, JobResult } from "./runner";

/** Monday 00:00 UTC of the week `now` falls in, as YYYY-MM-DD. */
export function weekStartOf(now: Date): string {
  const day = (now.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/**
 * Takes the weekly world snapshot once per week: the first pipeline run on or
 * after Monday 00:00 UTC records the 7 days before it. Later runs that week
 * find it already taken and do nothing.
 */
export async function takeSnapshot(db: Db, now = new Date()): Promise<JobResult> {
  const weekStart = weekStartOf(now);
  const { data: existing, error } = await db.from("snapshots").select("week_start").eq("week_start", weekStart).maybeSingle();
  if (error) throw new Error(`Checking snapshots failed: ${error.message}`);
  if (existing) return { itemsIn: 0, itemsOut: 0 };

  const { data, error: dataError } = await db.rpc("snapshot_data", { p_week_start: weekStart });
  if (dataError) throw new Error(`Building the snapshot failed: ${dataError.message}`);
  const { error: saveError } = await db.from("snapshots").insert({ week_start: weekStart, data });
  // 23505: another run saved this week's snapshot first.
  if (saveError && saveError.code !== "23505") throw new Error(`Saving the snapshot failed: ${saveError.message}`);
  return { itemsIn: 1, itemsOut: saveError ? 0 : 1 };
}
