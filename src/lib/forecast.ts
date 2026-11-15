/**
 * Attention-decay forecasting: when a story is 2 days old, the chance it is
 * still covered 5 to 8 days after it began. One input, the number of articles
 * on its second day (log scale), in a logistic regression. Chosen by backtest:
 * richer inputs scored worse on unseen stories, and this one beat the base
 * rate by about 10% (Brier score) on 94 held-out stories.
 * Pure functions; the database work is in jobs/forecast.ts.
 */

export interface DecayRow {
  day2: number;
  covered: boolean;
}

export interface DecayModel {
  coef: number;
  intercept: number;
}

/** L2 strength matches scikit-learn's C = 0.3, which the backtest chose. */
const C = 0.3;
/** Backtest: first train on this many stories, then predict the next block. */
const BACKTEST_START = 60;
const BACKTEST_STEP = 10;
/** The gate also needs enough held-out stories to mean something. */
export const MIN_BACKTEST = 50;

export const feature = (day2: number) => Math.log1p(day2);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function predict(model: DecayModel, day2: number): number {
  return sigmoid(model.intercept + model.coef * feature(day2));
}

/**
 * Logistic regression by Newton's method. Minimises the same objective as
 * scikit-learn: total log loss plus coef² / (2C); the intercept is not penalised.
 */
export function fit(rows: DecayRow[]): DecayModel {
  let b = 0;
  let w = 0;
  for (let iter = 0; iter < 100; iter++) {
    let gb = 0, gw = w / C, hbb = 0, hbw = 0, hww = 1 / C;
    for (const r of rows) {
      const x = feature(r.day2);
      const p = sigmoid(b + w * x);
      const e = p - (r.covered ? 1 : 0);
      const v = p * (1 - p);
      gb += e;
      gw += e * x;
      hbb += v;
      hbw += v * x;
      hww += v * x * x;
    }
    const det = hbb * hww - hbw * hbw;
    if (det <= 0) break;
    const db = (hww * gb - hbw * gw) / det;
    const dw = (hbb * gw - hbw * gb) / det;
    b -= db;
    w -= dw;
    if (Math.abs(db) + Math.abs(dw) < 1e-10) break;
  }
  return { coef: w, intercept: b };
}

export interface Evaluation extends DecayModel {
  trainedN: number;
  backtestN: number;
  modelBrier: number;
  baselineBrier: number;
  /** True only when the backtest beats always guessing the base rate. */
  passed: boolean;
}

/**
 * Expanding-window backtest on stories in time order: train on every story
 * before a block, forecast the block, compare with guessing the base rate of
 * the same training stories. Then refit on everything for live use.
 */
export function evaluate(rows: DecayRow[]): Evaluation {
  let modelErr = 0;
  let baseErr = 0;
  let n = 0;
  for (let i = BACKTEST_START; i < rows.length; i += BACKTEST_STEP) {
    const train = rows.slice(0, i);
    const model = fit(train);
    const base = train.filter((r) => r.covered).length / train.length;
    for (const r of rows.slice(i, i + BACKTEST_STEP)) {
      const y = r.covered ? 1 : 0;
      modelErr += (predict(model, r.day2) - y) ** 2;
      baseErr += (base - y) ** 2;
      n++;
    }
  }
  const final = fit(rows);
  const modelBrier = n ? modelErr / n : 0;
  const baselineBrier = n ? baseErr / n : 0;
  return {
    ...final,
    trainedN: rows.length,
    backtestN: n,
    modelBrier,
    baselineBrier,
    passed: n >= MIN_BACKTEST && modelBrier < baselineBrier,
  };
}

/** Skill against the base rate: positive means better, 0.1 means 10% lower error. */
export function skill(e: Pick<Evaluation, "modelBrier" | "baselineBrier">): number {
  return e.baselineBrier > 0 ? 1 - e.modelBrier / e.baselineBrier : 0;
}
