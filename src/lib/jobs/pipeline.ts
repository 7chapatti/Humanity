import "server-only";
import { getServerEnv } from "../config";
import { createCaller } from "../models";
import { createAdminClient } from "../supabase/admin";
import { cleanup } from "./cleanup";
import { ingest } from "./ingest";
import { runJob, type JobOutcome } from "./runner";
import { tagArticles } from "./tag";

/**
 * The information pipeline, run every 2 hours by Supabase Cron:
 * ingest new articles, tag them with the cheap model, prune old data.
 * Each step is logged separately; a failed step does not stop the next.
 */
export async function runPipeline(): Promise<JobOutcome[]> {
  const env = getServerEnv();
  const db = createAdminClient();
  const outcomes: JobOutcome[] = [];
  outcomes.push(await runJob(db, "ingest", () => ingest(db)));
  outcomes.push(await runJob(db, "tag", () => tagArticles(db, createCaller(env, env.TAG_MODEL))));
  outcomes.push(await runJob(db, "cleanup", () => cleanup(db)));
  return outcomes;
}
