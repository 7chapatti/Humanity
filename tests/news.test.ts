import { describe, expect, it } from "vitest";
import { cleanTitle, dedupeHeadlines, parseDate, parseFeed, readCapped } from "@/lib/news";

describe("parseFeed extra fields", () => {
  it("reads RSS summaries and dates", () => {
    const xml = `<rss version="2.0"><channel><item><title>A</title><link>https://x.com/a</link>
      <description><![CDATA[<p>Short &amp; <b>sharp</b>.</p>]]></description><pubDate>Wed, 21 Oct 2026 20:22:48 -0400</pubDate></item></channel></rss>`;
    const [item] = parseFeed(xml, "X");
    expect(item.summary).toBe("Short & sharp .");
    expect(item.publishedAt).toBe("2026-10-22T00:22:48.000Z");
  });

  it("reads Atom links from href, preferring rel=alternate, and typed titles", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Vote</title>
      <link rel="self" href="https://x.com/self"/><link rel="alternate" href="https://x.com/story"/>
      <summary>Due Thursday.</summary><updated>2026-10-21T10:00:00Z</updated></entry></feed>`;
    const [item] = parseFeed(xml, "X");
    expect(item).toMatchObject({ title: "Vote", link: "https://x.com/story", summary: "Due Thursday." });
    expect(item.publishedAt).toBe("2026-10-21T10:00:00.000Z");
  });
});

describe("parseDate", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  it("rejects junk and far-future dates", () => {
    expect(parseDate("yesterday-ish", now)).toBeNull();
    expect(parseDate("2027-01-01T00:00:00Z", now)).toBeNull();
    expect(parseDate(undefined, now)).toBeNull();
  });
});

describe("readCapped", () => {
  it("reads small bodies and refuses oversized ones without buffering them", async () => {
    expect(await readCapped(new Response("hello"), 10)).toBe("hello");
    await expect(readCapped(new Response("x".repeat(20)), 10)).rejects.toThrow("too large");
    await expect(
      readCapped(new Response("x", { headers: { "content-length": "999999" } }), 10),
    ).rejects.toThrow("too large");
  });
});

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Test</title>
  <item><title>Summit opens in Geneva</title><link>https://example.com/a</link></item>
  <item><title><![CDATA[Leaders <b>agree</b> to talk]]></title><link>javascript:alert(1)</link></item>
  <item><title></title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Vote set for Thursday</title></entry>
</feed>`;

describe("parseFeed", () => {
  it("reads RSS items, strips tags and drops empty titles", () => {
    const items = parseFeed(RSS, "example.com");
    expect(items.map((i) => i.title)).toEqual(["Summit opens in Geneva", "Leaders agree to talk"]);
  });

  it("keeps only http(s) links", () => {
    const items = parseFeed(RSS, "example.com");
    expect(items[0].link).toBe("https://example.com/a");
    expect(items[1].link).toBeNull();
  });

  it("reads Atom entries", () => {
    expect(parseFeed(ATOM, "x").map((i) => i.title)).toEqual(["Vote set for Thursday"]);
  });

  it("returns nothing for junk instead of throwing", () => {
    expect(parseFeed("not xml at all <<<", "x")).toEqual([]);
    expect(parseFeed("", "x")).toEqual([]);
  });

  it("does not expand custom entities", () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "BOOM">]><rss><channel><item><title>&x;</title></item></channel></rss>`;
    const titles = parseFeed(evil, "x").map((i) => i.title);
    expect(titles.join(" ")).not.toContain("BOOM");
  });
});

describe("cleanTitle", () => {
  it("removes control characters and caps length", () => {
    expect(cleanTitle("a\u0000b\nc")).toBe("a b c");
    expect(cleanTitle("x".repeat(500))?.length).toBe(301);
  });

  it("rejects non-strings", () => {
    expect(cleanTitle({ nested: true })).toBeNull();
    expect(cleanTitle(undefined)).toBeNull();
  });
});

describe("dedupeHeadlines", () => {
  it("drops case-insensitive repeats", () => {
    const out = dedupeHeadlines([
      { title: "Same", source: "a", link: null },
      { title: "same", source: "b", link: null },
      { title: "Other", source: "a", link: null },
    ]);
    expect(out.map((h) => h.source + h.title)).toEqual(["aSame", "aOther"]);
  });
});
