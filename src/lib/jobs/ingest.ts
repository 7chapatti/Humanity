import "server-only";
import { mapLimit } from "../concurrency";
import { fetchFeed, type FeedItem } from "../news";
import { normalizeUrl } from "../url";
import type { Db, JobResult } from "./runner";

const MAX_ITEMS_PER_SOURCE = 50;
const MAX_AGE_DAYS = 7;
const CONCURRENT_FEEDS = 4;

export interface ArticleRow {
  source_id: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: string | null;
}

/**
 * Turns feed items into article rows: canonical URL, drops items without a
 * usable link or older than a week, de-duplicates by URL within the batch.
 */
export function toArticleRows(items: FeedItem[], sourceId: string, now = Date.now()): ArticleRow[] {
  const cutoff = now - MAX_AGE_DAYS * 86_400_000;
  const seen = new Set<string>();
  const rows: ArticleRow[] = [];
  for (const item of items.slice(0, MAX_ITEMS_PER_SOURCE)) {
    const url = normalizeUrl(item.link);
    if (!url || seen.has(url)) continue;
    if (item.publishedAt && Date.parse(item.publishedAt) < cutoff) continue;
    seen.add(url);
    rows.push({
      source_id: sourceId,
      url,
      title: item.title.slice(0, 400),
      summary: item.summary?.slice(0, 700) ?? null,
      published_at: item.publishedAt,
    });
  }
  return rows;
}

interface SourceRow {
  id: string;
  name: string;
  url: string;
  consecutive_failures: number;
}

/** Fetches every active source; one failing feed is recorded on its row and never stops the rest. */
export async function ingest(db: Db): Promise<JobResult> {
  const { data: sources, error } = await db
    .from("sources")
    .select("id, name, url, consecutive_failures")
    .eq("active", true)
    .returns<SourceRow[]>();
  if (error) throw new Error(`Loading sources failed: ${error.message}`);
  if (!sources?.length) return { itemsIn: 0, itemsOut: 0 };

  const results = await mapLimit(sources, CONCURRENT_FEEDS, async (source) => {
    const fetchedAt = new Date().toISOString();
    try {
      const items = await fetchFeed(source.url, source.name);
      const rows = toArticleRows(items, source.id);
      let inserted = 0;
      if (rows.length > 0) {
        const { data, error: insertError } = await db
          .from("articles")
          .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
          .select("id");
        if (insertError) throw new Error(`Saving failed: ${insertError.message}`);
        inserted = data?.length ?? 0;
      }
      await db
        .from("sources")
        .update({ last_fetched_at: fetchedAt, last_item_count: items.length, last_error: null, consecutive_failures: 0 })
        .eq("id", source.id);
      return { fetched: items.length, inserted, failed: false };
    } catch (err) {
      const message = (err instanceof Error ? err.message : "Unknown error").slice(0, 300);
      await db
        .from("sources")
        .update({ last_fetched_at: fetchedAt, last_error: message, consecutive_failures: source.consecutive_failures + 1 })
        .eq("id", source.id);
      return { fetched: 0, inserted: 0, failed: true };
    }
  });

  if (results.every((r) => r.failed)) throw new Error(`All ${results.length} sources failed; see /admin/sources`);
  return {
    itemsIn: results.reduce((n, r) => n + r.fetched, 0),
    itemsOut: results.reduce((n, r) => n + r.inserted, 0),
  };
}
