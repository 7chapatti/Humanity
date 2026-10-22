import "server-only";
import type { ModelCaller, Usage } from "../ai";
import { chunk, mapLimit } from "../concurrency";
import { tagBatch, type ArticleToTag } from "../tagging";
import { addUsage, type Db, type JobResult } from "./runner";

const MAX_PER_RUN = 200;
const BATCH_SIZE = 40;
const MAX_ATTEMPTS = 3;
const CONCURRENT_UPDATES = 10;

interface UntaggedRow {
  id: string;
  title: string;
  summary: string | null;
  tag_attempts: number;
  sources: { name: string } | { name: string }[] | null;
}

function outletOf(row: UntaggedRow): string {
  const source = Array.isArray(row.sources) ? row.sources.at(0) : row.sources;
  return source?.name ?? "unknown";
}

/** Tags the newest untagged articles in batches; a failed batch is retried on later runs, up to 3 times. */
export async function tagArticles(db: Db, call: ModelCaller): Promise<JobResult> {
  const { data: rows, error } = await db
    .from("articles")
    .select("id, title, summary, tag_attempts, sources(name)")
    .is("tagged_at", null)
    .lt("tag_attempts", MAX_ATTEMPTS)
    .order("fetched_at", { ascending: false })
    .limit(MAX_PER_RUN)
    .returns<UntaggedRow[]>();
  if (error) throw new Error(`Loading articles failed: ${error.message}`);
  if (!rows?.length) return { itemsIn: 0, itemsOut: 0 };

  const attempts = new Map(rows.map((r) => [r.id, r.tag_attempts]));
  const markAttempt = (ids: string[]) =>
    mapLimit(ids, CONCURRENT_UPDATES, async (id) => {
      await db.from("articles").update({ tag_attempts: (attempts.get(id) ?? 0) + 1 }).eq("id", id);
    });

  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let tagged = 0;
  let failedBatches = 0;
  let lastError = "";
  const batches = chunk(rows, BATCH_SIZE);

  for (const batch of batches) {
    const articles: ArticleToTag[] = batch.map((r) => ({ id: r.id, title: r.title, summary: r.summary, outlet: outletOf(r) }));
    try {
      const result = await tagBatch(call, articles);
      usage = addUsage(usage, result.usage);
      const taggedAt = new Date().toISOString();
      await mapLimit(result.tags, CONCURRENT_UPDATES, async (t) => {
        const { error: updateError } = await db
          .from("articles")
          .update({ topic: t.topic, region: t.region, entities: t.entities, patterns: t.patterns, tagged_at: taggedAt })
          .eq("id", t.id);
        if (!updateError) tagged++;
      });
      const returned = new Set(result.tags.map((t) => t.id));
      await markAttempt(articles.filter((a) => !returned.has(a.id)).map((a) => a.id));
    } catch (err) {
      failedBatches++;
      lastError = err instanceof Error ? err.message : "Unknown error";
      await markAttempt(articles.map((a) => a.id));
    }
  }

  if (failedBatches === batches.length) throw new Error(lastError || "Every tagging batch failed");
  return { itemsIn: rows.length, itemsOut: tagged, usage };
}
