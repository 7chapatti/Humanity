import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { FLAG_LABELS, type SafetyFlag } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { signOut } from "../login/actions";
import { generateNow, markPosted, reviewPost } from "./actions";
import { CopyButton } from "./copy-button";

export const metadata: Metadata = {
  title: "Approvals — Humanity AI",
  robots: { index: false, follow: false },
};
// "Generate now" runs the whole batch inside the Server Action.
export const maxDuration = 300;

const STATUSES = ["draft", "approved", "posted", "rejected"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABELS: Record<Status, string> = {
  draft: "Drafts",
  approved: "Approved",
  posted: "Posted",
  rejected: "Rejected",
};

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  invalid: { text: "That request was not valid.", error: true },
  save: { text: "Could not save. Try again.", error: true },
  busy: { text: "A run is already in progress.", error: true },
  generate: { text: "Generation failed. Check the runs table and logs.", error: true },
};

interface PostRow {
  id: string;
  content: string;
  format: string;
  status: Status;
  flags: string[];
  headline_title: string | null;
  headline_source: string | null;
  headline_link: string | null;
  created_at: string;
}

interface RunRow {
  id: string;
  started_at: string;
  model: string;
  post_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  error: string | null;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});

function flagLabel(flag: string): string {
  return FLAG_LABELS[flag as SafetyFlag] ?? flag;
}

export default function AdminPage(props: PageProps<"/admin">) {
  // Everything here depends on the session cookie, so it renders per request.
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <AdminContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function AdminContent({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  const adminEmail = await requireAdmin();
  const params = await searchParams;
  const status: Status = STATUSES.includes(params.status as Status) ? (params.status as Status) : "draft";
  const message = typeof params.error === "string" ? MESSAGES[params.error] : undefined;
  const generated = typeof params.generated === "string" ? Number.parseInt(params.generated, 10) : NaN;

  const db = createAdminClient();
  const [{ data: posts, error: postsError }, { data: runs }] = await Promise.all([
    db
      .from("posts")
      .select("id, content, format, status, flags, headline_title, headline_source, headline_link, created_at")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<PostRow[]>(),
    db
      .from("generation_runs")
      .select("id, started_at, model, post_count, input_tokens, output_tokens, cache_read_tokens, error")
      .order("started_at", { ascending: false })
      .limit(5)
      .returns<RunRow[]>(),
  ]);

  return (
    <>
      <header>
        <h1>Humanity AI</h1>
        <nav aria-label="Post status">
          {STATUSES.map((s) => (
            <Link key={s} href={`/admin?status=${s}`} aria-current={s === status ? "page" : undefined}>
              {STATUS_LABELS[s]}
            </Link>
          ))}
        </nav>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </header>

      <main>
        {message && (
          <p className={message.error ? "notice error" : "notice"} role="alert">
            {message.text}
          </p>
        )}
        {Number.isFinite(generated) && (
          <p className="notice" role="status">
            New batch ready: <strong>{generated}</strong> drafts.
          </p>
        )}

        <section aria-labelledby="posts-heading">
          <h2 id="posts-heading">{STATUS_LABELS[status]}</h2>
          {postsError && <p className="error">Could not load posts.</p>}
          {posts?.length === 0 && <p>Nothing here.</p>}
          {posts?.map((post) => (
            <article key={post.id} aria-labelledby={`post-${post.id}`}>
              <header>
                <h3 id={`post-${post.id}`}>
                  <strong>{post.format.replace("_", " ")}</strong>
                </h3>
                <time dateTime={post.created_at}>{dateFormat.format(new Date(post.created_at))}</time>
              </header>

              {post.status === "draft" ? (
                <form action={reviewPost}>
                  <input type="hidden" name="id" value={post.id} />
                  <label htmlFor={`content-${post.id}`}>Post text (edit before approving if needed)</label>
                  <textarea id={`content-${post.id}`} name="content" defaultValue={post.content} maxLength={1000} required />
                  <p className="inline-actions">
                    <button type="submit" name="decision" value="approved">
                      Approve
                    </button>{" "}
                    <button type="submit" name="decision" value="rejected">
                      Reject
                    </button>
                  </p>
                </form>
              ) : (
                <p className="post">{post.content}</p>
              )}

              {post.flags.map((flag) => (
                <p key={flag} className="flag">
                  <strong>Check:</strong> {flagLabel(flag)}
                </p>
              ))}

              {post.headline_title && (
                <p className="source">
                  Responding to:{" "}
                  {post.headline_link ? (
                    <a href={post.headline_link} target="_blank" rel="noopener noreferrer nofollow">
                      {post.headline_title}
                    </a>
                  ) : (
                    post.headline_title
                  )}
                  {post.headline_source && ` (${post.headline_source})`}
                </p>
              )}

              {post.status === "approved" && (
                <form action={markPosted} className="inline">
                  <input type="hidden" name="id" value={post.id} />
                  <CopyButton text={post.content} />
                  <button type="submit">Mark as posted</button>
                </form>
              )}
            </article>
          ))}
        </section>

        <section aria-labelledby="runs-heading" className="runs">
          <h2 id="runs-heading">Recent runs</h2>
          <form action={generateNow} className="inline">
            <button type="submit">Generate a batch now</button>
          </form>
          {runs && runs.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Model</th>
                  <th scope="col">Drafts</th>
                  <th scope="col">Tokens in / cached / out</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <time dateTime={run.started_at}>{dateFormat.format(new Date(run.started_at))}</time>
                    </td>
                    <td>{run.model}</td>
                    <td>{run.post_count}</td>
                    <td>
                      {run.input_tokens ?? "–"} / {run.cache_read_tokens ?? "–"} / {run.output_tokens ?? "–"}
                    </td>
                    <td>{run.error ? <strong>{run.error}</strong> : "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No runs yet.</p>
          )}
        </section>
      </main>

      <footer>
        <p>
          Signed in as <strong>{adminEmail}</strong>. Nothing is published automatically.
        </p>
      </footer>
    </>
  );
}
