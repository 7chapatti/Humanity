import "server-only";
import type { ModelCaller, Usage } from "../ai";
import { chunk } from "../concurrency";
import { ARTICLES_PER_STORY, summariseThreads, type ThreadToSummarise } from "../threads";
import { addUsage, type Db, type JobResult } from "./runner";

/** Only stories covered more than once get a written title and summary. */
const MIN_ARTICLES = 2;
const MAX_PER_RUN = 60;
const BATCH_SIZE = 15;
const ACTIVE_DAYS = 7;

interface ThreadRow {
  id: string;
  article_count: number;
  summarized_count: number;
}

interface ArticleRow {
  thread_id: string;
  title: string;
  summary: string | null;
  sources: { name: string } | { name: string }[] | null;
}

/**
 * Names and summarises active threads whose summary is missing or behind
 * their article count, biggest first, with the cheap model.
 */
export async function summarizeThreads(db: Db, call: ModelCaller): Promise<JobResult> {
  const since = new Date(Date.now() - ACTIVE_DAYS * 86_400_000).toISOString();
  const { data: active, error } = await db
    .from("threads")
    .select("id, article_count, summarized_count")
    .gte("last_seen", since)
    .gte("article_count", MIN_ARTICLES)
    .order("article_count", { ascending: false })
    .limit(500)
    .returns<ThreadRow[]>();
  if (error) throw new Error(`Loading threads failed: ${error.message}`);
  const due = (active ?? []).filter((t) => t.summarized_count < t.article_count).slice(0, MAX_PER_RUN);
  if (due.length === 0) return { itemsIn: 0, itemsOut: 0 };

  const { data: articles, error: articleError } = await db
    .from("articles")
    .select("thread_id, title, summary, sources(name)")
    .in("thread_id", due.map((t) => t.id))
    .order("published_at", { ascending: false, nullsFirst: false })
    .returns<ArticleRow[]>();
  if (articleError) throw new Error(`Loading thread articles failed: ${articleError.message}`);

  const byThread = new Map<string, ThreadToSummarise["articles"]>();
  for (const a of articles ?? []) {
    const list = byThread.get(a.thread_id) ?? [];
    if (list.length < ARTICLES_PER_STORY) {
      const source = Array.isArray(a.sources) ? a.sources.at(0) : a.sources;
      list.push({ title: a.title, summary: a.summary, outlet: source?.name ?? "unknown" });
    }
    byThread.set(a.thread_id, list);
  }
  const threads: ThreadToSummarise[] = due
    .map((t) => ({ id: t.id, articles: byThread.get(t.id) ?? [] }))
    .filter((t) => t.articles.length > 0);
  const counts = new Map(due.map((t) => [t.id, t.article_count]));

  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let written = 0;
  for (const batch of chunk(threads, BATCH_SIZE)) {
    const result = await summariseThreads(call, batch);
    usage = addUsage(usage, result.usage);
    for (const s of result.summaries) {
      const { error: saveError } = await db
        .from("threads")
        .update({ title: s.title, summary: s.summary, summarized_count: counts.get(s.id) ?? 0 })
        .eq("id", s.id);
      if (!saveError) written++;
    }
  }
  return { itemsIn: threads.length, itemsOut: written, usage };
}
