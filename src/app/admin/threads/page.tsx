import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { momentum, parseSnapshot } from "@/lib/stories";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminHeader } from "../admin-header";

export const metadata: Metadata = {
  title: "Threads — Humanity AI",
  robots: { index: false, follow: false },
};

const ACTIVE_DAYS = 7;
const MAX_THREADS = 60;

interface ThreadRow {
  id: string;
  title: string;
  summary: string | null;
  article_count: number;
  first_seen: string;
  last_seen: string;
}

interface ArticleRow {
  id: string;
  thread_id: string;
  title: string;
  url: string;
  sources: { name: string } | { name: string }[] | null;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});

/** Start of the active window. Kept outside render (the clock is impure). */
function activeSince(): string {
  return new Date(Date.now() - ACTIVE_DAYS * 86_400_000).toISOString();
}

function outletOf(row: ArticleRow): string {
  const source = Array.isArray(row.sources) ? row.sources.at(0) : row.sources;
  return source?.name ?? "Unknown outlet";
}

export default function ThreadsPage() {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <ThreadsContent />
    </Suspense>
  );
}

/**
 * The biggest stories of the last week, each with the articles grouped into
 * it, so the grouping can be checked: one story per thread, no stragglers.
 */
async function ThreadsContent() {
  await requireAdmin();
  const db = createAdminClient();
  const since = activeSince();

  const { data: threads, error } = await db
    .from("threads")
    .select("id, title, summary, article_count, first_seen, last_seen")
    .gte("last_seen", since)
    .gte("article_count", 2)
    .order("article_count", { ascending: false })
    .limit(MAX_THREADS)
    .returns<ThreadRow[]>();

  const { data: latest } = await db
    .from("snapshots")
    .select("week_start, data")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle<{ week_start: string; data: unknown }>();
  const snapshot = latest ? parseSnapshot(latest.data) : null;

  const ids = (threads ?? []).map((t) => t.id);
  const { data: articles } = ids.length
    ? await db
        .from("articles")
        .select("id, thread_id, title, url, sources(name)")
        .in("thread_id", ids)
        .order("published_at", { ascending: false, nullsFirst: false })
        .returns<ArticleRow[]>()
    : { data: [] as ArticleRow[] };

  const byThread = new Map<string, ArticleRow[]>();
  for (const a of articles ?? []) byThread.set(a.thread_id, [...(byThread.get(a.thread_id) ?? []), a]);

  return (
    <>
      <AdminHeader current="/admin/threads" />
      <main>
        <section aria-labelledby="snapshot-heading">
          <h2 id="snapshot-heading">Weekly snapshot</h2>
          {latest && snapshot ? (
            <>
              <p>
                The 7 days before <time dateTime={latest.week_start}>{latest.week_start}</time>:{" "}
                <strong>{snapshot.articles}</strong> articles read. Taken every Monday; the writer uses it as background.
              </p>
              <h3>Biggest stories</h3>
              <ol>
                {snapshot.top.map((t) => (
                  <li key={t.title}>
                    <strong>{t.title}</strong>: {t.outlets} outlets, {momentum(t.articles, t.last_week)}
                  </li>
                ))}
              </ol>
              <h3>Faded without resolution</h3>
              {snapshot.faded.length > 0 ? (
                <ul>
                  {snapshot.faded.map((f) => (
                    <li key={f.title}>{f.title}</li>
                  ))}
                </ul>
              ) : (
                <p>None this week.</p>
              )}
            </>
          ) : (
            <p>No snapshot yet. The first is taken on the first pipeline run after Monday 00:00 UTC.</p>
          )}
        </section>

        <section aria-labelledby="threads-heading">
          <h2 id="threads-heading">Threads</h2>
          <p>
            Stories covered more than once in the last {ACTIVE_DAYS} days, biggest first. Check that each thread holds one
            story and that the same story is not split across threads.
          </p>
          {error && <p className="error">Could not load threads.</p>}
          {threads?.length === 0 && <p>No threads yet. They form after the next pipeline run.</p>}
          {threads?.map((t) => {
            const list = byThread.get(t.id) ?? [];
            const outlets = new Set(list.map(outletOf)).size;
            return (
              <article key={t.id} aria-labelledby={`thread-${t.id}`}>
                <header>
                  <h3 id={`thread-${t.id}`}>{t.title}</h3>
                  <p className="source">
                    <strong>{t.article_count}</strong> articles from <strong>{outlets}</strong> outlets ·{" "}
                    <time dateTime={t.first_seen}>{dateFormat.format(new Date(t.first_seen))}</time> to{" "}
                    <time dateTime={t.last_seen}>{dateFormat.format(new Date(t.last_seen))}</time>
                  </p>
                </header>
                {t.summary ? <p>{t.summary}</p> : <p className="source">Summary pending.</p>}
                <details>
                  <summary>Articles</summary>
                  <ul>
                    {list.map((a) => (
                      <li key={a.id}>
                        <a href={a.url} target="_blank" rel="noopener noreferrer nofollow">
                          {a.title}
                        </a>{" "}
                        ({outletOf(a)})
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            );
          })}
        </section>
      </main>
    </>
  );
}
