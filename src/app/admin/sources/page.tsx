import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { label, PERSPECTIVES, REGIONS } from "@/lib/taxonomy";
import { addSource, setSourceActive } from "../actions";
import { AdminHeader } from "../admin-header";

export const metadata: Metadata = {
  title: "Sources — Humanity AI",
  robots: { index: false, follow: false },
};

interface SourceRow {
  id: string;
  name: string;
  url: string;
  region: string;
  perspective: string;
  active: boolean;
  last_fetched_at: string | null;
  last_item_count: number | null;
  last_error: string | null;
  consecutive_failures: number;
}

const MESSAGES: Record<string, { text: string; error: boolean }> = {
  invalid: { text: "Check the form: the address must be a public https feed.", error: true },
  duplicate: { text: "That feed is already in the list.", error: true },
  save: { text: "Could not save. Try again.", error: true },
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/London",
});

export default function SourcesPage(props: PageProps<"/admin/sources">) {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <SourcesContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SourcesContent({ searchParams }: Pick<PageProps<"/admin/sources">, "searchParams">) {
  await requireAdmin();
  const params = await searchParams;
  const message = typeof params.error === "string" ? MESSAGES[params.error] : undefined;

  const db = createAdminClient();
  const { data: sources, error } = await db
    .from("sources")
    .select("id, name, url, region, perspective, active, last_fetched_at, last_item_count, last_error, consecutive_failures")
    .order("region")
    .order("name")
    .returns<SourceRow[]>();

  const active = sources?.filter((s) => s.active) ?? [];
  const byRegion = new Map<string, number>();
  for (const s of active) byRegion.set(s.region, (byRegion.get(s.region) ?? 0) + 1);

  return (
    <>
      <AdminHeader current="/admin/sources" />
      <main>
        {message && (
          <p className="notice error" role="alert">
            {message.text}
          </p>
        )}
        {params.added === "1" && (
          <p className="notice" role="status">
            Source added. It is fetched on the next pipeline run.
          </p>
        )}

        <section aria-labelledby="sources-heading" className="runs">
          <h2 id="sources-heading">Sources</h2>
          <p>
            <strong>{active.length}</strong> active across <strong>{byRegion.size}</strong> regions. A source that keeps failing shows
            its last error here; pause it or replace its address.
          </p>
          {error && <p className="error">Could not load sources.</p>}
          <table>
            <thead>
              <tr>
                <th scope="col">Outlet</th>
                <th scope="col">Region</th>
                <th scope="col">Perspective</th>
                <th scope="col">Last fetched</th>
                <th scope="col">Items</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sources?.map((s) => (
                <tr key={s.id}>
                  <th scope="row">
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                      {s.name}
                    </a>
                  </th>
                  <td>{label(s.region)}</td>
                  <td>{s.perspective}</td>
                  <td>
                    {s.last_fetched_at ? (
                      <time dateTime={s.last_fetched_at}>{dateFormat.format(new Date(s.last_fetched_at))}</time>
                    ) : (
                      "never"
                    )}
                  </td>
                  <td>{s.last_item_count ?? "–"}</td>
                  <td>
                    {!s.active ? (
                      "Paused"
                    ) : s.last_error ? (
                      <strong>
                        Failing ×{s.consecutive_failures}: {s.last_error}
                      </strong>
                    ) : (
                      "OK"
                    )}
                  </td>
                  <td>
                    <form action={setSourceActive}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                      <button type="submit">{s.active ? "Pause" : "Resume"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="add-heading">
          <h2 id="add-heading">Add a source</h2>
          <p>
            Use the outlet&apos;s RSS or Atom feed address. Check its terms first: many allow headlines and links with
            attribution, but not every outlet allows commercial use.
          </p>
          <form action={addSource}>
            <label htmlFor="source-name">Outlet name</label>
            <input id="source-name" name="name" required maxLength={100} />
            <label htmlFor="source-url">Feed address (https)</label>
            <input id="source-url" name="url" type="url" required maxLength={500} placeholder="https://" />
            <label htmlFor="source-region">Region</label>
            <select id="source-region" name="region" required defaultValue="">
              <option value="" disabled>
                Choose a region
              </option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
            <label htmlFor="source-perspective">Perspective</label>
            <select id="source-perspective" name="perspective" defaultValue="unrated">
              {PERSPECTIVES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button type="submit">Add source</button>
          </form>
        </section>
      </main>
    </>
  );
}
