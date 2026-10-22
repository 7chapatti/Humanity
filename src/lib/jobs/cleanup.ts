import "server-only";
import type { Db, JobResult } from "./runner";

/** Keeps the free database small: articles and job logs older than this are deleted. */
export const RETENTION_DAYS = 90;

export async function cleanup(db: Db): Promise<JobResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const articles = await db.from("articles").delete({ count: "exact" }).lt("fetched_at", cutoff);
  if (articles.error) throw new Error(`Deleting old articles failed: ${articles.error.message}`);
  const runs = await db.from("job_runs").delete({ count: "exact" }).lt("started_at", cutoff).not("finished_at", "is", null);
  if (runs.error) throw new Error(`Deleting old job runs failed: ${runs.error.message}`);
  const removed = (articles.count ?? 0) + (runs.count ?? 0);
  return { itemsIn: removed, itemsOut: removed };
}
