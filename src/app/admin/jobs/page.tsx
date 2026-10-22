import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPipelineNow } from "../actions";
import { AdminHeader } from "../admin-header";

export const metadata: Metadata = {
  title: "Jobs — Humanity AI",
  robots: { index: false, follow: false },
};
// "Run now" executes the whole pipeline inside the Server Action.
export const maxDuration = 300;

interface JobRunRow {
  id: string;
  job: string;
  started_at: string;
  finished_at: string | null;
  items_in: number;
  items_out: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  error: string | null;
}

const JOB_LABELS: Record<string, { name: string; counts: string }> = {
  ingest: { name: "Ingest", counts: "fetched → new" },
  tag: { name: "Tag", counts: "untagged → tagged" },
  cleanup: { name: "Cleanup", counts: "old rows removed" },
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Europe/London",
});

function seconds(run: JobRunRow): string {
  if (!run.finished_at) return "running";
  return `${Math.max(0, Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000))} s`;
}

/** Total and failed runs over the last 7 days, counted in the database. */
async function weekStats(db: ReturnType<typeof createAdminClient>): Promise<{ total: number; failed: number }> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [total, failed] = await Promise.all([
    db.from("job_runs").select("id", { count: "exact", head: true }).gte("started_at", since),
    db.from("job_runs").select("id", { count: "exact", head: true }).gte("started_at", since).not("error", "is", null),
  ]);
  return { total: total.count ?? 0, failed: failed.count ?? 0 };
}

export default function JobsPage(props: PageProps<"/admin/jobs">) {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <JobsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function JobsContent({ searchParams }: Pick<PageProps<"/admin/jobs">, "searchParams">) {
  await requireAdmin();
  const params = await searchParams;
  const failed = typeof params.failed === "string" ? params.failed.split(",").filter((j) => j in JOB_LABELS) : [];

  const db = createAdminClient();
  const [{ data: runs, error }, week] = await Promise.all([
    db
      .from("job_runs")
      .select("id, job, started_at, finished_at, items_in, items_out, input_tokens, output_tokens, cached_tokens, error")
      .order("started_at", { ascending: false })
      .limit(36)
      .returns<JobRunRow[]>(),
    weekStats(db),
  ]);

  return (
    <>
      <AdminHeader current="/admin/jobs" />
      <main>
        {params.ran === "1" && (
          <p className="notice" role="status">
            Pipeline finished. Results are below.
          </p>
        )}
        {failed.length > 0 && (
          <p className="notice error" role="alert">
            Failed: {failed.map((j) => JOB_LABELS[j].name).join(", ")}. The error is in the table below.
          </p>
        )}

        <section aria-labelledby="jobs-heading" className="runs">
          <h2 id="jobs-heading">Jobs</h2>
          <p>
            The pipeline runs every 2 hours: ingest new articles, tag them, then remove data older than 90 days. Phase 2 gate:
            under 5% failed runs over a week. Last 7 days: <strong>{week.failed}</strong> failed of <strong>{week.total}</strong>.
          </p>
          <form action={runPipelineNow} className="inline">
            <button type="submit">Run the pipeline now</button>
          </form>
          {error && <p className="error">Could not load job runs.</p>}
          {runs?.length === 0 && <p>No runs yet.</p>}
          {runs && runs.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Job</th>
                  <th scope="col">Items</th>
                  <th scope="col">Tokens in / cached / out</th>
                  <th scope="col">Took</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <time dateTime={r.started_at}>{dateFormat.format(new Date(r.started_at))}</time>
                    </td>
                    <td>{JOB_LABELS[r.job]?.name ?? r.job}</td>
                    <td>
                      {r.items_in} → {r.items_out}
                      <span className="visually-hidden"> ({JOB_LABELS[r.job]?.counts})</span>
                    </td>
                    <td>
                      {r.input_tokens ?? "–"} / {r.cached_tokens ?? "–"} / {r.output_tokens ?? "–"}
                    </td>
                    <td>{seconds(r)}</td>
                    <td>{r.error ? <strong>{r.error}</strong> : r.finished_at ? "OK" : "Running"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
