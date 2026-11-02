import "server-only";
import { getServerEnv } from "../config";
import OpenAI from "openai";
import { openaiEmbedder } from "../embeddings";
import { createCaller } from "../models";
import { createAdminClient } from "../supabase/admin";
import { cleanup } from "./cleanup";
import { embedArticles } from "./embed";
import { ingest } from "./ingest";
import { runJob, type JobOutcome } from "./runner";
import { summarizeThreads } from "./summarize";
import { tagArticles } from "./tag";
import { threadArticles } from "./thread";

/**
 * The information pipeline, run every 2 hours by Supabase Cron: ingest new
 * articles, tag them with the cheap model, embed them, group them into story
 * threads, name and summarise the threads, then prune old data.
 * Embeddings need an OpenAI key; without one those steps are skipped.
 * Each step is logged separately; a failed step does not stop the next.
 */
export async function runPipeline(): Promise<JobOutcome[]> {
  const env = getServerEnv();
  const db = createAdminClient();
  const outcomes: JobOutcome[] = [];
  outcomes.push(await runJob(db, "ingest", () => ingest(db)));
  outcomes.push(await runJob(db, "tag", () => tagArticles(db, createCaller(env, env.TAG_MODEL))));
  if (env.OPENAI_API_KEY) {
    const embedder = openaiEmbedder(new OpenAI({ apiKey: env.OPENAI_API_KEY }));
    outcomes.push(await runJob(db, "embed", () => embedArticles(db, embedder)));
    outcomes.push(await runJob(db, "thread", () => threadArticles(db)));
    outcomes.push(await runJob(db, "summarize", () => summarizeThreads(db, createCaller(env, env.TAG_MODEL))));
  }
  outcomes.push(await runJob(db, "cleanup", () => cleanup(db)));
  return outcomes;
}
