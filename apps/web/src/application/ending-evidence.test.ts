import { beforeAll, describe, expect, it } from "vitest";
import type {
  CausalContribution,
  GameState,
  MonthlyReportSnapshot,
} from "@macro-nation/domain";
import { createGame } from "./game-service";
import { selectEndingEvidence } from "./ending-evidence";
import {
  monthlyEvidenceQuery,
  parseMonthlyEvidence,
  selectMonthlyEvidence,
  type ReportCause,
} from "./monthly-evidence";

let initial: GameState;
beforeAll(async () => {
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "ending-evidence",
  );
});

function cause(
  indicatorId = "governmentDebtRatio",
  delta = 0.1,
  sourceId = "saved-policy",
): ReportCause {
  return {
    indicatorId,
    sourceType: "policy",
    sourceId,
    labelKey: "policy.effect",
    delta,
  };
}

function report(
  monthIndex: number,
  values: Readonly<Record<string, number>>,
  topCauses: readonly ReportCause[] = [],
): MonthlyReportSnapshot {
  return { monthIndex, values, topCauses };
}

function stage(saved: ReportCause): CausalContribution {
  const { indicatorId, ...term } = saved;
  return {
    indicatorId,
    beforeValue: 1,
    afterValue: 1 + saved.delta,
    totalDelta: saved.delta,
    contributions: [{ ...term, sourceType: "policy", confidence: "medium" }],
    diagnostics: [],
  };
}

function game(...reports: MonthlyReportSnapshot[]): GameState {
  return {
    ...initial,
    runState: "completed",
    monthIndex: 48,
    history: { ...initial.history, reports },
  };
}

function mismatchedPeriods(): GameState {
  return game(
    report(0, { exports: 100, governmentDebtRatio: 0.5 }),
    report(47, { exports: 2550, governmentDebtRatio: 0.8 }, [
      cause("exports", 12),
    ]),
    report(48, { exports: 2600, governmentDebtRatio: 0.9 }, [cause()]),
  );
}

function freeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

describe("ending evidence periods", () => {
  it("keeps a 48-month export change separate from final-month debt causes", () => {
    const state = mismatchedPeriods();
    const selected = selectEndingEvidence(state);
    expect(selected.period).toEqual({ startMonthIndex: 0, endMonthIndex: 48 });
    expect(selected.largestChange).toEqual({
      indicatorId: "exports",
      before: 100,
      after: 2600,
      delta: 2500,
      target: { monthIndex: 47, indicatorId: "exports", row: 0 },
    });
    expect(selected.finalMonth).toMatchObject({
      report: state.history.reports!.at(-1),
      cause: cause(),
      target: { monthIndex: 48, indicatorId: "governmentDebtRatio", row: 0 },
      completeness: "legacy-incomplete",
    });
    expect(
      selectMonthlyEvidence(state, selected.largestChange!.target).causes,
    ).toEqual([cause("exports", 12)]);
  });

  it("preserves absolute endpoint-difference ranking and stored order for ties", () => {
    const selected = selectEndingEvidence(
      game(
        report(0, { exports: 100, realGdp: 100, inflation: 0.1 }),
        report(48, { exports: 50, realGdp: 150, inflation: 1 }),
      ),
    );
    expect(selected.largestChange).toMatchObject({
      indicatorId: "exports",
      before: 100,
      after: 50,
      delta: -50,
    });
  });

  it("does not call partial retained history a comparison from the start", () => {
    const selected = selectEndingEvidence(
      game(
        report(24, { exports: 100 }),
        report(48, { exports: 300 }, [cause("exports")]),
      ),
    );
    expect(selected.missing).toBe("initial-report");
    expect(selected.largestChange).toBeUndefined();
    expect(selected.finalMonth.cause).toEqual(cause("exports"));
  });

  it("requires the actual final month instead of substituting the latest stored month", () => {
    const selected = selectEndingEvidence(
      game(
        report(0, { exports: 100 }),
        report(47, { exports: 300 }, [cause("exports")]),
      ),
    );
    expect(selected.missing).toBe("final-report");
    expect(selected.largestChange).toBeUndefined();
    expect(selected.finalMonth).toEqual({ missing: "report" });
  });

  it("does not fill absent or non-finite endpoint values with zero or today's economy", () => {
    const selected = selectEndingEvidence(
      game(
        report(0, { exports: 100, inflation: Number.NaN, realGdp: 100 }),
        report(48, {
          governmentDebtRatio: 999,
          inflation: 200,
          realGdp: Number.POSITIVE_INFINITY,
        }),
      ),
    );
    expect(selected.missing).toBe("comparable-values");
    expect(selected.largestChange).toBeUndefined();
  });

  it("preserves real zero endpoints and zero changes", () => {
    const selected = selectEndingEvidence(
      game(report(0, { exports: 0 }), report(48, { exports: 0 })),
    );
    expect(selected.largestChange).toEqual({
      indicatorId: "exports",
      before: 0,
      after: 0,
      delta: 0,
      target: { monthIndex: 48, indicatorId: "exports", row: 0 },
      evidenceMissing: "cause",
    });
  });

  it("requires an elapsed month before presenting a period comparison", () => {
    const selected = selectEndingEvidence({
      ...game(report(0, { exports: 0 })),
      monthIndex: 0,
    });
    expect(selected.missing).toBe("comparable-values");
    expect(selected.largestChange).toBeUndefined();
  });

  it("keeps a matching value-only target when the indicator's causes were not retained", () => {
    const state = game(
      report(0, { exports: 100 }),
      report(48, { exports: 2600 }, [cause()]),
    );
    const selected = selectEndingEvidence(state);
    expect(selected.largestChange).toMatchObject({
      evidenceMissing: "cause",
      target: { monthIndex: 48, indicatorId: "exports", row: 0 },
    });
    expect(
      selectMonthlyEvidence(state, selected.largestChange!.target),
    ).toMatchObject({
      causes: [],
      missing: "cause",
    });
  });

  it("uses a saved complete trace even when its indicator is absent from the top summary", () => {
    const final: MonthlyReportSnapshot = {
      ...report(48, { exports: 2600, governmentDebtRatio: 0.9 }, [cause()]),
      causalTrace: {
        completeness: "complete",
        indicators: [stage(cause()), stage(cause("exports", 0.01))],
      },
    };
    const state = game(
      report(0, { exports: 100, governmentDebtRatio: 0.5 }),
      report(47, { exports: 2550 }, [cause("exports", 1000)]),
      final,
    );
    const selected = selectEndingEvidence(state);
    expect(selected.largestChange!.target).toEqual({
      monthIndex: 48,
      indicatorId: "exports",
      row: 0,
    });
    expect(selected.largestChange!.evidenceMissing).toBeUndefined();
    expect(selected.finalMonth.cause).toEqual(cause());
    expect(selected.largestChange!.delta).toBe(2500);
  });

  it("uses an available exact indicator cause from the authoritative complete trace", () => {
    const retained = cause("governmentDebtRatio", 0.00001, "trace-policy");
    const final: MonthlyReportSnapshot = {
      ...report(48, { exports: 300 }, [cause()]),
      causalTrace: {
        completeness: "complete",
        indicators: [stage(retained), stage(cause("exports", 1000))],
      },
    };
    const selected = selectEndingEvidence(
      game(report(0, { exports: 100 }), final),
    );
    expect(selected.finalMonth.cause).toEqual(retained);
    expect(selected.finalMonth.target).toEqual({
      monthIndex: 48,
      indicatorId: "governmentDebtRatio",
      row: 0,
    });
  });

  it("falls back to stored trace order without comparing different indicators' units", () => {
    const first = cause("inflation", 0.00001, "first-stage");
    const final: MonthlyReportSnapshot = {
      ...report(48, { exports: 300 }, [cause("unavailable")]),
      causalTrace: {
        completeness: "complete",
        indicators: [stage(first), stage(cause("exports", 1000))],
      },
    };
    expect(
      selectEndingEvidence(game(report(0, { exports: 100 }), final)).finalMonth
        .cause,
    ).toEqual(first);
  });

  it("does not replace absent final-month evidence with earlier or non-finite causes", () => {
    const final: MonthlyReportSnapshot = {
      ...report(48, { exports: 300 }, [cause("exports", 99)]),
      causalTrace: {
        completeness: "complete",
        indicators: [stage(cause("exports", Number.NaN))],
      },
    };
    const selected = selectEndingEvidence(
      game(
        report(0, { exports: 100 }),
        report(47, { exports: 250 }, [cause("exports")]),
        final,
      ),
    );
    expect(selected.finalMonth).toEqual({
      report: final,
      completeness: "complete",
      missing: "cause",
      target: { monthIndex: 48, indicatorId: "exports", row: 0 },
    });
    expect(selected.largestChange!.target.monthIndex).toBe(47);
  });

  it("provides the final record target despite missing start values and causes", () => {
    const final = report(48, { exports: 300 });
    const selected = selectEndingEvidence(game(final));
    expect(selected.missing).toBe("initial-report");
    expect(selected.finalMonth).toEqual({
      report: final,
      completeness: "legacy-incomplete",
      missing: "cause",
      target: { monthIndex: 48, indicatorId: "exports", row: 0 },
    });
  });

  it("preserves evidence after serialization and URL reload without changing frozen state", () => {
    const state = mismatchedPeriods();
    const before = structuredClone(state);
    freeze(state);
    const selected = selectEndingEvidence(state);
    const reloaded = JSON.parse(JSON.stringify(state)) as GameState;
    expect(selectEndingEvidence(reloaded)).toEqual(selected);
    for (const target of [
      selected.largestChange!.target,
      selected.finalMonth.target!,
    ]) {
      const restored = parseMonthlyEvidence(monthlyEvidenceQuery(target))!;
      expect(restored).toEqual(target);
      expect(selectMonthlyEvidence(reloaded, restored)).toEqual(
        selectMonthlyEvidence(state, target),
      );
    }
    expect(state).toEqual(before);
  });

  it("handles an old save without monthly reports explicitly", () => {
    const history = { ...initial.history };
    delete history.reports;
    const selected = selectEndingEvidence({
      ...initial,
      monthIndex: 48,
      history,
    });
    expect(selected).toEqual({
      period: { startMonthIndex: 0, endMonthIndex: 48 },
      finalMonth: { missing: "report" },
      missing: "initial-report",
    });
  });
});
