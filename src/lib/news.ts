import { XMLParser } from "fast-xml-parser";

export interface Headline {
  title: string;
  source: string;
  link: string | null;
}

/** A feed entry with the extra fields the ingest job stores. */
export interface FeedItem extends Headline {
  summary: string | null;
  publishedAt: string | null;
}

export const MAX_FEED_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_TITLE_LENGTH = 300;
const MAX_SUMMARY_LENGTH = 600;
const USER_AGENT = "HumanityAI-FeedReader/1.0 (+https://humanity-ai-mu.vercel.app)";

const parser = new XMLParser({
  // Attributes are needed for Atom links (<link href="..."/>).
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Feeds are untrusted: never expand entities beyond the XML built-ins.
  processEntities: false,
  htmlEntities: false,
});

/** Text content of a parsed node: a plain value, or an element with attributes ({ "#text": ... }). */
function textOf(raw: unknown): string | null {
  if (typeof raw === "string" || typeof raw === "number") return String(raw);
  if (raw && typeof raw === "object" && "#text" in raw) return textOf((raw as Record<string, unknown>)["#text"]);
  return null;
}

/** Strips tags and control characters, decodes the basic entities, collapses whitespace, caps length. */
export function cleanText(raw: unknown, max: number): string | null {
  const value = textOf(raw);
  if (value === null) return null;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " })[e] ?? "",
    )
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function cleanTitle(raw: unknown): string | null {
  return cleanText(raw, MAX_TITLE_LENGTH);
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

/** RSS gives a string; Atom gives one or more <link href rel> elements. */
function linkOf(raw: unknown): string | null {
  if (typeof raw === "string") return safeLink(raw);
  const links = [raw].flat().filter((l): l is Record<string, unknown> => !!l && typeof l === "object");
  const preferred = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
  return preferred ? safeLink(preferred["@_href"] ?? textOf(preferred)) : null;
}

/** ISO date, or null when missing, unparseable, or more than a day in the future. */
export function parseDate(raw: unknown, now = Date.now()): string | null {
  const value = textOf(raw);
  if (!value) return null;
  const time = Date.parse(value.trim());
  if (Number.isNaN(time) || time > now + 86_400_000) return null;
  return new Date(time).toISOString();
}

/** Parses RSS 2.0 or Atom XML into items. Never throws on bad input. */
export function parseFeed(xml: string, source: string): FeedItem[] {
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

  const out: FeedItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = cleanTitle(record.title);
    if (!title) continue;
    out.push({
      title,
      source,
      link: linkOf(record.link),
      summary: cleanText(record.description ?? record.summary, MAX_SUMMARY_LENGTH),
      publishedAt: parseDate(record.pubDate ?? record["dc:date"] ?? record.published ?? record.updated),
    });
  }
  return out;
}

/** Reads a response body, stopping once it passes the byte cap (no unbounded buffering). */
export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Feed is too large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Feed is too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchFeed(url: string, source = new URL(url).hostname): Promise<FeedItem[]> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "user-agent": USER_AGENT,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await readCapped(res, MAX_FEED_BYTES), source);
}

/** De-duplicates by lowercased title. Keeps first occurrence. */
export function dedupeHeadlines<T extends Headline>(headlines: T[]): T[] {
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
 * never stops the run. Fallback for when the articles table is empty.
 */
export async function fetchHeadlines(urls: string[], limit = 40): Promise<Headline[]> {
  const results = await Promise.allSettled(urls.map((u) => fetchFeed(u)));
  const all: Headline[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") all.push(...r.value.slice(0, Math.ceil(limit / urls.length) + 5));
    else console.error(`Skipping feed ${urls[i]}:`, r.reason instanceof Error ? r.reason.message : r.reason);
  });
  return dedupeHeadlines(all).slice(0, limit);
}
