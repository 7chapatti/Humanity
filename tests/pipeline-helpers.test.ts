import { describe, expect, it } from "vitest";
import { pickBalanced } from "@/lib/balance";
import { chunk, mapLimit } from "@/lib/concurrency";
import { toArticleRows } from "@/lib/jobs/ingest";
import type { FeedItem } from "@/lib/news";

describe("pickBalanced", () => {
  it("takes turns across groups, newest first within each", () => {
    const items = ["a1", "a2", "a3", "a4", "b1", "c1", "c2"].map((id) => ({ id, group: id[0] }));
    expect(pickBalanced(items, (i) => i.group, 5).map((i) => i.id)).toEqual(["a1", "b1", "c1", "a2", "c2"]);
  });

  it("returns everything when there are fewer than n", () => {
    expect(pickBalanced([1, 2], () => "x", 10)).toEqual([1, 2]);
  });
});

describe("mapLimit and chunk", () => {
  it("keeps order and never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("splits into fixed-size pieces", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("toArticleRows", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const item = (link: string | null, publishedAt: string | null = "2026-10-22T08:00:00Z"): FeedItem => ({
    title: "T",
    source: "S",
    link,
    summary: "sum",
    publishedAt,
  });

  it("normalises URLs, drops duplicates, unusable links and items older than a week", () => {
    const rows = toArticleRows(
      [
        item("https://x.com/a?utm_source=rss"),
        item("https://x.com/a"),
        item(null),
        item("javascript:alert(1)"),
        item("https://x.com/old", "2026-10-10T00:00:00Z"),
        item("https://x.com/undated", null),
      ],
      "src-1",
      now,
    );
    expect(rows.map((r) => r.url)).toEqual(["https://x.com/a", "https://x.com/undated"]);
    expect(rows[0]).toMatchObject({ source_id: "src-1", title: "T", summary: "sum" });
  });
});
