import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { predict, skill } from "@/lib/forecast";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminHeader } from "../admin-header";

export const metadata: Metadata = {
  title: "Forecasts — Humanity AI",
  robots: { index: false, follow: false },
};

interface ModelRow {
  coef: number;
  intercept: number;
  trained_n: number;
  backtest_n: number;
  model_brier: number;
  baseline_brier: number;
  passed: boolean;
  fitted_at: string;
}

interface ForecastRow {
  id: string;
  title: string;
  probability: number;
  status: "open" | "resolved" | "void";
  outcome: boolean | null;
  brier: number | null;
  window_end: string;
  made_at: string;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" });
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Calibration bands: within each, the forecast chance should match how often it happened. */
const BANDS = [
  [0, 0.2],
  [0.2, 0.4],
  [0.4, 0.6],
  [0.6, 0.8],
  [0.8, 1.01],
] as const;

export default function ForecastsPage() {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <ForecastsContent />
    </Suspense>
  );
}

async function ForecastsContent() {
  await requireAdmin();
  const db = createAdminClient();
  const [{ data: model }, { data: forecasts }] = await Promise.all([
    db.from("forecast_models").select("*").eq("kind", "attention_decay").maybeSingle<ModelRow>(),
    db
      .from("forecasts")
      .select("id, title, probability, status, outcome, brier, window_end, made_at")
      .eq("kind", "attention_decay")
      .order("made_at", { ascending: false })
      .limit(300)
      .returns<ForecastRow[]>(),
  ]);

  const open = (forecasts ?? []).filter((f) => f.status === "open");
  const resolved = (forecasts ?? []).filter((f) => f.status === "resolved");
  const liveBrier = resolved.length ? resolved.reduce((s, f) => s + (f.brier ?? 0), 0) / resolved.length : null;

  return (
    <>
      <AdminHeader current="/admin/forecasts" />
      <main>
        <section aria-labelledby="model-heading">
          <h2 id="model-heading">Attention decay</h2>
          <p>
            When a story is 2 days old: the chance it is still being covered 5 to 8 days after it began. The model is
            refitted and tested on past stories every pipeline run, and only makes forecasts while it beats always guessing
            the average.
          </p>
          {model ? (
            <>
              <p className={model.passed ? "notice" : "notice error"} role="status">
                {model.passed ? (
                  <>
                    <strong>Passing:</strong> {pct(skill({ modelBrier: model.model_brier, baselineBrier: model.baseline_brier }))} more accurate than guessing the average, tested on{" "}
                    {model.backtest_n} past stories.
                  </>
                ) : (
                  <>
                    <strong>Paused:</strong> not beating the average on past stories ({pct(skill({ modelBrier: model.model_brier, baselineBrier: model.baseline_brier }))} skill, {model.backtest_n}{" "}
                    tested). No new forecasts until it does.
                  </>
                )}
              </p>
              <table>
                <caption>What the current model says (trained on {model.trained_n} stories)</caption>
                <thead>
                  <tr>
                    <th scope="col">Articles on day 2</th>
                    <th scope="col">Chance still covered</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 4, 8].map((d) => (
                    <tr key={d}>
                      <td>{d}</td>
                      <td>{pct(predict(model, d))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p>No model yet. It is fitted on the next pipeline run.</p>
          )}
        </section>

        <section aria-labelledby="calibration-heading">
          <h2 id="calibration-heading">Calibration</h2>
          {resolved.length === 0 ? (
            <p>No forecasts have resolved yet. The first ones resolve a week after they are made.</p>
          ) : (
            <>
              <p>
                <strong>{resolved.length}</strong> resolved. Average error (Brier score, lower is better):{" "}
                <strong>{liveBrier?.toFixed(3)}</strong>
                {model && <> against {model.baseline_brier.toFixed(3)} for guessing the average in testing</>}.
              </p>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Forecast chance</th>
                    <th scope="col">Forecasts</th>
                    <th scope="col">Actually still covered</th>
                  </tr>
                </thead>
                <tbody>
                  {BANDS.map(([lo, hi]) => {
                    const band = resolved.filter((f) => f.probability >= lo && f.probability < hi);
                    const hits = band.filter((f) => f.outcome).length;
                    return (
                      <tr key={lo}>
                        <td>
                          {pct(lo)} to {pct(Math.min(hi, 1))}
                        </td>
                        <td>{band.length}</td>
                        <td>{band.length ? pct(hits / band.length) : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section aria-labelledby="open-heading">
          <h2 id="open-heading">Open forecasts</h2>
          {open.length === 0 ? (
            <p>None open.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Story</th>
                  <th scope="col">Chance still covered</th>
                  <th scope="col">Resolves</th>
                </tr>
              </thead>
              <tbody>
                {open.map((f) => (
                  <tr key={f.id}>
                    <td>{f.title}</td>
                    <td>{pct(f.probability)}</td>
                    <td>
                      <time dateTime={f.window_end}>{dateFormat.format(new Date(f.window_end))}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="resolved-heading">
          <h2 id="resolved-heading">Resolved</h2>
          {resolved.length === 0 ? (
            <p>None yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Story</th>
                  <th scope="col">Forecast</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {resolved.slice(0, 50).map((f) => (
                  <tr key={f.id}>
                    <td>{f.title}</td>
                    <td>{pct(f.probability)} still covered</td>
                    <td>{f.outcome ? "Still covered" : "Forgotten"}</td>
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
