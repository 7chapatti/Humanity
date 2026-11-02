import "server-only";
import { chunk } from "../concurrency";
import { embeddingText, type Embedder } from "../embeddings";
import type { Db, JobResult } from "./runner";

const MAX_PER_RUN = 600;
const BATCH_SIZE = 100;

interface Row {
  id: string;
  title: string;
  summary: string | null;
}

/** Embeds tagged articles that have no embedding yet, newest first. */
export async function embedArticles(db: Db, embed: Embedder): Promise<JobResult> {
  const { data: rows, error } = await db
    .from("articles")
    .select("id, title, summary")
    .is("embedding", null)
    .not("tagged_at", "is", null)
    .order("fetched_at", { ascending: false })
    .limit(MAX_PER_RUN)
    .returns<Row[]>();
  if (error) throw new Error(`Loading articles failed: ${error.message}`);
  if (!rows?.length) return { itemsIn: 0, itemsOut: 0 };

  let stored = 0;
  let tokens = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const { vectors, tokens: used } = await embed(batch.map((r) => embeddingText(r.title, r.summary)));
    tokens += used;
    const payload = batch.map((r, i) => ({ id: r.id, e: vectors[i] }));
    const { data, error: saveError } = await db.rpc("set_embeddings", { p_rows: payload });
    if (saveError) throw new Error(`Saving embeddings failed: ${saveError.message}`);
    stored += typeof data === "number" ? data : 0;
  }
  return { itemsIn: rows.length, itemsOut: stored, usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0 } };
}
