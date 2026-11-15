import { describe, expect, it } from "vitest";
import rows from "./fixtures/decay-rows.json";
import { evaluate, fit, predict, skill, type DecayRow } from "@/lib/forecast";

// 154 real stories, in time order: [articles on day 2, still covered days 5 to 8 (1/0)].
const data: DecayRow[] = (rows as number[][]).map(([day2, y]) => ({ day2, covered: y === 1 }));

describe("attention-decay model", () => {
  it("matches scikit-learn's fit on the same data", () => {
    const m = fit(data);
    expect(m.coef).toBeCloseTo(1.0978, 3);
    expect(m.intercept).toBeCloseTo(-1.5182, 3);
    expect(predict(m, 0)).toBeCloseTo(0.18, 2);
    expect(predict(m, 8)).toBeCloseTo(0.71, 2);
  });

  it("reproduces the backtest: beats the base rate by about 10% and passes the gate", () => {
    const e = evaluate(data);
    expect(e.backtestN).toBe(94);
    expect(e.modelBrier).toBeCloseTo(0.1867, 3);
    expect(e.baselineBrier).toBeCloseTo(0.2074, 3);
    expect(skill(e)).toBeGreaterThan(0.09);
    expect(e.passed).toBe(true);
  });

  it("fails the gate with too few stories or no signal", () => {
    expect(evaluate(data.slice(0, 80)).passed).toBe(false);
    const noise: DecayRow[] = Array.from({ length: 160 }, (_, i) => ({ day2: i % 5, covered: i % 3 === 0 }));
    expect(evaluate(noise).passed).toBe(false);
  });
});
