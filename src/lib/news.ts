import { XMLParser } from "fast-xml-parser";

export interface Headline {
  title: string;
  source: string;
  link: string | null;
}

const MAX_FEED_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_TITLE_LENGTH = 300;

const parser = new XMLParser({
  ignoreAttributes: true,
  // Feeds are untrusted: never expand entities beyond the XML built-ins.
  processEntities: false,
  htmlEntities: false,
});

/** Strips control characters and tags, collapses whitespace, caps length. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e: string) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" })[e] ?? "",
    )
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH)}…` : text;
}

function safeLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Parses RSS 2.0 or Atom XML into headlines. Never throws on bad input. */
export function parseFeed(xml: string, source: string): Headline[] {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const root = doc as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rssItems = root?.rss?.channel?.item;
  const atomItems = root?.feed?.entry;
  const items: unknown[] = [rssItems ?? atomItems ?? []].flat();

  const headlines: Headline[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = cleanTitle(record.title);
    if (!title) continue;
    headlines.push({ title, source, link: safeLink(record.link) });
  }
  return headlines;
}

async function fetchFeed(url: string): Promise<Headline[]> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
    headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Feed ${url} returned ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FEED_BYTES) throw new Error(`Feed ${url} is too large`);
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error(`Feed ${url} is too large`);
  return parseFeed(text, new URL(url).hostname);
}

/** De-duplicates by lowercased title. Keeps first occurrence. */
export function dedupeHeadlines(headlines: Headline[]): Headline[] {
  const seen = new Set<string>();
  return headlines.filter((h) => {
    const key = h.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Fetches all feeds; a failing feed is logged and skipped so one bad source
 * never stops the run.
 */
export async function fetchHeadlines(urls: string[], limit = 40): Promise<Headline[]> {
  const results = await Promise.allSettled(urls.map(fetchFeed));
  const all: Headline[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") all.push(...r.value.slice(0, Math.ceil(limit / urls.length) + 5));
    else console.error(`Skipping feed ${urls[i]}:`, r.reason instanceof Error ? r.reason.message : r.reason);
  });
  return dedupeHeadlines(all).slice(0, limit);
}
