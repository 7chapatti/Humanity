import "server-only";
import { evaluate, predict, type DecayRow } from "../forecast";
import type { Db, JobResult } from "./runner";

interface Row {
  thread_id: string;
  title: string;
  first_seen: string;
  n48: number;
  day1: number;
  day2: number;
  covered: boolean | null;
}

const DAY = 86_400_000;
/** The question: still covered between 5 and 8 days after the story began. */
const WINDOW_START_DAYS = 5;
const WINDOW_END_DAYS = 8;

/**
 * Each run: score forecasts whose week is up, refit and backtest the model on
 * every story old enough to know the answer, and forecast newly 2-day-old
 * stories only if the backtest still beats the base rate.
 */
export async function runForecasts(db: Db): Promise<JobResult> {
  const { error: resolveError } = await db.rpc("resolve_decay_forecasts");
  if (resolveError) throw new Error(`Scoring forecasts failed: ${resolveError.message}`);

  const { data: history, error } = await db.rpc("decay_rows", { p_resolved: true });
  if (error) throw new Error(`Loading story history failed: ${error.message}`);
  const training: DecayRow[] = ((history ?? []) as Row[]).map((r) => ({ day2: r.day2, covered: r.covered === true }));
  const model = evaluate(training);

  const { error: saveError } = await db.from("forecast_models").upsert({
    kind: "attention_decay",
    coef: model.coef,
    intercept: model.intercept,
    trained_n: model.trainedN,
    backtest_n: model.backtestN,
    model_brier: model.modelBrier,
    baseline_brier: model.baselineBrier,
    passed: model.passed,
    fitted_at: new Date().toISOString(),
  });
  if (saveError) throw new Error(`Saving the model failed: ${saveError.message}`);
  if (!model.passed) return { itemsIn: 0, itemsOut: 0 };

  const { data: live, error: liveError } = await db.rpc("decay_rows", { p_resolved: false });
  if (liveError) throw new Error(`Loading live stories failed: ${liveError.message}`);
  const candidates = (live ?? []) as Row[];
  if (candidates.length === 0) return { itemsIn: 0, itemsOut: 0 };

  const rows = candidates.map((r) => {
    const start = Date.parse(r.first_seen);
    return {
      kind: "attention_decay",
      thread_id: r.thread_id,
      title: r.title.slice(0, 200),
      probability: predict(model, r.day2),
      features: { n48: r.n48, day1: r.day1, day2: r.day2 },
      window_start: new Date(start + WINDOW_START_DAYS * DAY).toISOString(),
      window_end: new Date(start + WINDOW_END_DAYS * DAY).toISOString(),
    };
  });
  const { data: inserted, error: insertError } = await db
    .from("forecasts")
    .upsert(rows, { onConflict: "kind,thread_id", ignoreDuplicates: true })
    .select("id");
  if (insertError) throw new Error(`Saving forecasts failed: ${insertError.message}`);
  return { itemsIn: candidates.length, itemsOut: inserted?.length ?? 0 };
}
