import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { label, PATTERNS, REGIONS, TOPICS } from "@/lib/taxonomy";
import { AdminHeader } from "../admin-header";

export const metadata: Metadata = {
  title: "Articles — Humanity AI",
  robots: { index: false, follow: false },
};

interface ArticleRow {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
  fetched_at: string;
  topic: string | null;
  region: string | null;
  entities: string[];
  patterns: string[];
  tagged_at: string | null;
  sources: { name: string } | { name: string }[] | null;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function outletOf(row: ArticleRow): string {
  const source = Array.isArray(row.sources) ? row.sources.at(0) : row.sources;
  return source?.name ?? "Unknown outlet";
}

export default function ArticlesPage(props: PageProps<"/admin/articles">) {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <ArticlesContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function ArticlesContent({ searchParams }: Pick<PageProps<"/admin/articles">, "searchParams">) {
  await requireAdmin();
  const params = await searchParams;
  const pattern = pick(params.pattern, PATTERNS);
  const topic = pick(params.topic, TOPICS);
  const region = pick(params.region, REGIONS);
  const untagged = params.untagged === "1";

  const db = createAdminClient();
  let query = db
    .from("articles")
    .select("id, title, url, summary, published_at, fetched_at, topic, region, entities, patterns, tagged_at, sources(name)")
    .order("fetched_at", { ascending: false })
    .limit(100);
  if (pattern) query = query.contains("patterns", [pattern]);
  if (topic) query = query.eq("topic", topic);
  if (region) query = query.eq("region", region);
  if (untagged) query = query.is("tagged_at", null);

  const [{ data: articles, error }, total, waiting] = await Promise.all([
    query.returns<ArticleRow[]>(),
    db.from("articles").select("id", { count: "exact", head: true }),
    db.from("articles").select("id", { count: "exact", head: true }).is("tagged_at", null),
  ]);

  const filtered = Boolean(pattern || topic || region || untagged);

  return (
    <>
      <AdminHeader current="/admin/articles" />
      <main>
        <section aria-labelledby="articles-heading">
          <h2 id="articles-heading">Articles</h2>
          <p>
            <strong>{total.count ?? 0}</strong> stored, <strong>{waiting.count ?? 0}</strong> waiting to be tagged. Showing the
            newest 100{filtered ? " that match the filter" : ""}. Spot-check that topics, regions and patterns fit the headline.
          </p>

          <form method="get" className="inline" aria-label="Filter articles">
            <label>
              Pattern{" "}
              <select name="pattern" defaultValue={pattern ?? ""}>
                <option value="">Any</option>
                {PATTERNS.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Topic{" "}
              <select name="topic" defaultValue={topic ?? ""}>
                <option value="">Any</option>
                {TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Region{" "}
              <select name="region" defaultValue={region ?? ""}>
                <option value="">Any</option>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" name="untagged" value="1" defaultChecked={untagged} /> Untagged only
            </label>
            <button type="submit">Filter</button>
            {filtered && <Link href="/admin/articles">Clear</Link>}
          </form>

          {error && <p className="error">Could not load articles.</p>}
          {articles?.length === 0 && <p>Nothing here yet. Articles arrive with each pipeline run.</p>}

          {articles?.map((a) => (
            <article key={a.id} aria-labelledby={`article-${a.id}`}>
              <header>
                <strong>{outletOf(a)}</strong>
                <time dateTime={a.published_at ?? a.fetched_at}>{dateFormat.format(new Date(a.published_at ?? a.fetched_at))}</time>
              </header>
              <h3 id={`article-${a.id}`}>
                <a href={a.url} target="_blank" rel="noopener noreferrer nofollow">
                  {a.title}
                </a>
              </h3>
              {a.summary && <p className="source">{a.summary}</p>}
              {a.tagged_at ? (
                <dl className="tags">
                  <dt>Topic</dt>
                  <dd>{a.topic ? label(a.topic) : "–"}</dd>
                  <dt>Region</dt>
                  <dd>{a.region ? label(a.region) : "–"}</dd>
                  <dt>Patterns</dt>
                  <dd>{a.patterns.length ? a.patterns.map(label).join(", ") : "none"}</dd>
                  <dt>Names</dt>
                  <dd>{a.entities.length ? a.entities.join(", ") : "none"}</dd>
                </dl>
              ) : (
                <p className="flag">Not tagged yet.</p>
              )}
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
