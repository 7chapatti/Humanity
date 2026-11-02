import "server-only";
import type { Db, JobResult } from "./runner";

/**
 * How alike an article must be to a thread to join it (cosine similarity,
 * 0 to 1). Tuned on real articles: same-story pairs score above it, different
 * stories on the same topic below.
 */
export const THREAD_MIN_SIMILARITY = 0.6;
/** An article only joins a thread active within this many days of it. */
export const THREAD_WINDOW_DAYS = 7;
/**
 * Two threads this alike are one story that split early on, and are merged.
 * Tuned on real threads: the same story split in two scored 0.77 to 0.80,
 * neighbouring stories (France vs Germany protests) 0.73.
 */
export const MERGE_MIN_SIMILARITY = 0.75;
const MAX_PER_RUN = 800;

/**
 * Groups embedded articles into threads, oldest first, so a story's thread
 * forms in the order it was reported. Matching and the running centroid live
 * in the assign_thread database function.
 */
export async function threadArticles(db: Db): Promise<JobResult> {
  const { data: rows, error } = await db
    .from("articles")
    .select("id")
    .is("thread_id", null)
    .not("embedding", "is", null)
    .order("published_at", { ascending: true, nullsFirst: false })
    .limit(MAX_PER_RUN)
    .returns<{ id: string }[]>();
  if (error) throw new Error(`Loading articles failed: ${error.message}`);
  let assigned = 0;
  for (const row of rows ?? []) {
    const { data, error: assignError } = await db.rpc("assign_thread", {
      p_article: row.id,
      p_min_similarity: THREAD_MIN_SIMILARITY,
      p_window_days: THREAD_WINDOW_DAYS,
    });
    if (assignError) throw new Error(`Threading failed: ${assignError.message}`);
    if (data) assigned++;
  }

  const { error: mergeError } = await db.rpc("merge_similar_threads", {
    p_min_similarity: MERGE_MIN_SIMILARITY,
    p_window_days: THREAD_WINDOW_DAYS,
  });
  if (mergeError) throw new Error(`Merging threads failed: ${mergeError.message}`);
  return { itemsIn: rows?.length ?? 0, itemsOut: assigned };
}
