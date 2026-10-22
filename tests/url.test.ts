import { describe, expect, it } from "vitest";
import { isSafeFeedUrl, normalizeUrl } from "@/lib/url";

describe("normalizeUrl", () => {
  it("drops tracking parameters and fragments, lowercases the host", () => {
    expect(normalizeUrl("https://News.Example.com/a/b?utm_source=x&id=7&fbclid=1#top")).toBe(
      "https://news.example.com/a/b?id=7",
    );
  });

  it("makes the same story from two tracked links match", () => {
    expect(normalizeUrl("https://x.com/s?utm_medium=rss")).toBe(normalizeUrl("https://x.com/s?utm_campaign=feed"));
  });

  it("rejects non-web and broken links", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("ftp://x.com/f")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(`https://x.com/${"a".repeat(2100)}`)).toBeNull();
  });
});

describe("isSafeFeedUrl", () => {
  it("accepts normal https feeds", () => {
    expect(isSafeFeedUrl("https://feeds.npr.org/1004/rss.xml")).toBe(true);
  });

  it("rejects http, credentials, ports, IPs and internal hosts", () => {
    for (const bad of [
      "http://feeds.npr.org/rss.xml",
      "https://user:pw@feeds.npr.org/rss.xml",
      "https://feeds.npr.org:8443/rss.xml",
      "https://127.0.0.1/feed",
      "https://10.0.0.5/feed",
      "https://[::1]/feed",
      "https://localhost/feed",
      "https://printer.local/feed",
      "https://metadata.internal/feed",
      "https://intranet/feed",
    ]) {
      expect(isSafeFeedUrl(bad), bad).toBe(false);
    }
  });
});
