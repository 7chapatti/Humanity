import "server-only";
import type { Usage } from "../ai";
import type { createAdminClient } from "../supabase/admin";

export type Db = ReturnType<typeof createAdminClient>;
export type JobName = "ingest" | "tag" | "cleanup";

export interface JobResult {
  itemsIn: number;
  itemsOut: number;
  usage?: Usage;
}

export type JobOutcome =
  | { job: JobName; status: "done"; itemsIn: number; itemsOut: number }
  | { job: JobName; status: "skipped" }
  | { job: JobName; status: "failed"; error: string };

/** An unfinished run older than this is treated as crashed and closed. */
const STALE_MINUTES = 15;

/**
 * Runs one job with a job_runs row around it: one active run per job
 * (database-enforced), crashed runs closed, counts, tokens and errors recorded.
 * Never throws; the outcome says what happened.
 */
export async function runJob(db: Db, job: JobName, fn: () => Promise<JobResult>): Promise<JobOutcome> {
  const now = Date.now();
  await db
    .from("job_runs")
    .update({ finished_at: new Date(now).toISOString(), error: "Run timed out or crashed" })
    .eq("job", job)
    .is("finished_at", null)
    .lt("started_at", new Date(now - STALE_MINUTES * 60_000).toISOString());

  const { data: run, error: startError } = await db.from("job_runs").insert({ job }).select("id").single();
  // 23505 = unique violation: this job is already running.
  if (startError?.code === "23505") return { job, status: "skipped" };
  if (startError || !run) {
    const message = startError?.message ?? "Could not start run";
    console.error(`[${job}] could not start:`, message);
    return { job, status: "failed", error: message };
  }

  try {
    const result = await fn();
    await db
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        items_in: result.itemsIn,
        items_out: result.itemsOut,
        input_tokens: result.usage?.inputTokens ?? null,
        output_tokens: result.usage?.outputTokens ?? null,
        cached_tokens: result.usage?.cacheReadTokens ?? null,
      })
      .eq("id", run.id);
    return { job, status: "done", itemsIn: result.itemsIn, itemsOut: result.itemsOut };
  } catch (err) {
    const message = (err instanceof Error ? err.message : "Unknown error").slice(0, 500);
    console.error(`[${job}] failed:`, message);
    await db.from("job_runs").update({ finished_at: new Date().toISOString(), error: message }).eq("id", run.id);
    return { job, status: "failed", error: message };
  }
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}
