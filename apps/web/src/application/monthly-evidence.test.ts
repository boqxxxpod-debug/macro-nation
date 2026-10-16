import { beforeAll, describe, expect, it } from "vitest";
import type {
  CausalContribution,
  GameState,
  MonthlyReportSnapshot,
} from "@macro-nation/domain";
import { createGame } from "./game-service";
import {
  monthlyBriefButtonId,
  monthlyEvidenceQuery,
  parseMonthlyEvidence,
  selectMonthlyBrief,
  selectMonthlyEvidence,
  savedReportIndicatorIds,
  selectReportCauses,
  type MonthlyEvidenceTarget,
  type ReportCause,
} from "./monthly-evidence";

let initial: GameState;
beforeAll(async () => {
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "monthly-evidence",
  );
});

function cause(overrides: Partial<ReportCause> = {}): ReportCause {
  return {
    indicatorId: "realGdp",
    sourceType: "policy",
    sourceId: "saved-policy",
    labelKey: "policy.effect",
    delta: 1,
    ...overrides,
  };
}

function report(
  monthIndex: number,
  topCauses: readonly ReportCause[] = [],
  values: Readonly<Record<string, number>> = initial.history.reports![0]!
    .values,
): MonthlyReportSnapshot {
  return { monthIndex, values, topCauses };
}

function game(...reports: MonthlyReportSnapshot[]): GameState {
  return {
    ...initial,
    monthIndex: reports.at(-1)?.monthIndex ?? 0,
    history: { ...initial.history, reports },
  };
}

describe("monthly evidence selectors", () => {
  it("finds the requested old month instead of the latest month", () => {
    const oldCause = cause({ delta: -4 });
    const old = report(1, [oldCause]);
    const newer = report(2, [cause({ delta: 20 })]);
    expect(
      selectMonthlyEvidence(game(old, newer), {
        monthIndex: 1,
        indicatorId: "realGdp",
        row: 0,
      }),
    ).toEqual({ report: old, causes: [oldCause] });
  });

  it("reports a missing month without substituting another snapshot", () => {
    expect(
      selectMonthlyEvidence(game(report(2, [cause()])), {
        monthIndex: 1,
        indicatorId: "realGdp",
        row: 0,
      }),
    ).toEqual({ causes: [], missing: "report" });
  });

  it("distinguishes an unspecified indicator from absent saved causes", () => {
    const saved = report(1, [cause({ indicatorId: "inflation" })]);
    const state = game(saved);
    expect(selectMonthlyEvidence(state, { monthIndex: 1, row: 0 })).toEqual({
      report: saved,
      causes: [],
      missing: "indicator",
    });
    expect(
      selectMonthlyEvidence(state, {
        monthIndex: 1,
        indicatorId: "realGdp",
        row: 1,
      }),
    ).toEqual({ report: saved, causes: [], missing: "cause" });
  });

  it("sorts all matching saved causes by absolute delta, preserving ties", () => {
    const positive = cause({ sourceId: "positive", delta: 5 });
    const negative = cause({ sourceId: "negative", delta: -9 });
    const tied = cause({ sourceId: "tied", delta: -5 });
    const saved = report(1, [
      positive,
      cause({ indicatorId: "inflation", delta: 100 }),
      negative,
      tied,
    ]);
    expect(
      selectMonthlyEvidence(game(saved), {
        monthIndex: 1,
        indicatorId: "realGdp",
        row: 1,
      }).causes,
    ).toEqual([negative, positive, tied]);
  });

  it("does not apply the report screen's display limit or an eight-item limit", () => {
    const causes = Array.from({ length: 12 }, (_, index) =>
      cause({ sourceId: `saved-${index}`, delta: index + 1 }),
    );
    expect(
      selectMonthlyEvidence(game(report(1, causes)), {
        monthIndex: 1,
        indicatorId: "realGdp",
        row: 0,
      }).causes,
    ).toEqual([...causes].reverse());
  });

  it("resolves a saved reason even when its metric has no snapshot value", () => {
    const savedCause = cause({ indicatorId: "publicCapital" });
    const saved = report(1, [savedCause]);
    expect(saved.values.publicCapital).toBeUndefined();
    expect(
      selectMonthlyEvidence(game(saved), {
        monthIndex: 1,
        row: 2,
        cause: savedCause,
      }),
    ).toEqual({ report: saved, causes: [savedCause] });
  });

  it("returns only the exact reason displayed by the third line", () => {
    const shown = cause({ delta: -1 });
    const saved = report(1, [
      cause({ delta: 30 }),
      shown,
      cause({ sourceId: "other", delta: -50 }),
    ]);
    expect(
      selectMonthlyEvidence(game(saved), {
        monthIndex: 1,
        indicatorId: shown.indicatorId,
        row: 2,
        cause: shown,
      }),
    ).toEqual({ report: saved, causes: [shown] });
  });

  it.each([
    { indicatorId: "inflation" },
    { sourceType: "external" },
    { sourceId: "different-source" },
    { labelKey: "different.label" },
    { delta: -1 },
  ])(
    "does not substitute a partially matching third-line reason: %j",
    (overrides) => {
      const saved = report(1, [cause()]);
      expect(
        selectMonthlyEvidence(game(saved), {
          monthIndex: 1,
          indicatorId: "realGdp",
          row: 2,
          cause: cause(overrides),
        }),
      ).toEqual({ report: saved, causes: [], missing: "cause" });
    },
  );

  it("keeps a neutral third line without a reason instead of choosing another", () => {
    const saved = report(1, [cause()]);
    expect(
      selectMonthlyEvidence(game(saved), { monthIndex: 1, row: 2 }),
    ).toEqual({
      report: saved,
      causes: [],
      missing: "cause",
    });
  });

  it("leaves the game, saved cause order, and values unchanged", () => {
    const state = game(report(1, [cause(), cause({ delta: -20 })]));
    const before = structuredClone(state);
    selectMonthlyEvidence(state, {
      monthIndex: 1,
      indicatorId: "realGdp",
      row: 0,
    });
    selectMonthlyBrief(state);
    expect(state).toEqual(before);
  });
});

describe("saved indicator breakdown", () => {
  function stage(
    overrides: Partial<CausalContribution> = {},
  ): CausalContribution {
    return {
      indicatorId: "realGdp",
      beforeValue: 100,
      afterValue: 100.00001,
      totalDelta: 0.00001,
      diagnostics: [],
      contributions: [
        {
          sourceType: "inertia",
          sourceId: "gdp",
          labelKey: "gdp",
          delta: 0.00001,
          confidence: "high",
        },
      ],
      ...overrides,
    };
  }

  it("uses all saved stages rather than the cross-indicator summary or current values", () => {
    const saved: MonthlyReportSnapshot = {
      ...report(1, [cause({ indicatorId: "politicalCapital", delta: -100 })]),
      causalTrace: {
        completeness: "complete",
        indicators: [
          stage(),
          stage({
            beforeValue: 100.00001,
            afterValue: 100.00003,
            totalDelta: 0.00002,
            contributions: [
              {
                sourceType: "random",
                sourceId: "gdp-noise",
                labelKey: "gdp.noise",
                delta: 0.00002,
                confidence: "low",
              },
            ],
          }),
        ],
      },
    };
    const state = game(saved, report(2));
    const before = structuredClone(state);
    const selected = selectReportCauses(state, {
      monthIndex: 1,
      indicatorId: "realGdp",
    });
    expect(selected).toMatchObject({
      report: saved,
      completeness: "complete",
      beforeValue: 100,
      afterValue: 100.00003,
    });
    expect(selected.totalDelta).toBeCloseTo(0.00003, 12);
    expect(selected.contributionSum).toBeCloseTo(0.00003, 12);
    expect(selected.causes.map((item) => item.sourceId)).toEqual([
      "gdp-noise",
      "gdp",
    ]);
    expect(
      selectMonthlyEvidence(state, {
        monthIndex: 1,
        indicatorId: "realGdp",
        row: 0,
      }).causes,
    ).toEqual(selected.causes);
    expect(state).toEqual(before);
  });

  it("lists retained metrics outside the brief, including values with no causal record", () => {
    const saved: MonthlyReportSnapshot = {
      ...report(1, [cause({ indicatorId: "politicalCapital" })], {
        realGdp: 100,
        inflation: 0.02,
      }),
      causalTrace: {
        completeness: "complete",
        indicators: [stage(), stage({ indicatorId: "publicCapital" })],
      },
    };
    expect(savedReportIndicatorIds(saved)).toEqual([
      "realGdp",
      "inflation",
      "publicCapital",
      "politicalCapital",
    ]);
    expect(savedReportIndicatorIds()).toEqual([]);
  });

  it("keeps legacy causes and missing bounds without inferring prior/current values", () => {
    const saved = report(1, [cause()], { realGdp: 200 });
    expect(
      selectReportCauses(game(report(0, [], { realGdp: 100 }), saved), {
        monthIndex: 1,
        indicatorId: "realGdp",
      }),
    ).toEqual({
      report: saved,
      causes: [cause()],
      completeness: "legacy-incomplete",
    });
    expect(
      selectReportCauses(game(saved), {
        monthIndex: 1,
        indicatorId: "inflation",
      }),
    ).toEqual({
      report: saved,
      causes: [],
      completeness: "legacy-incomplete",
      missing: "cause",
    });
    expect(
      selectReportCauses(game(saved), {
        monthIndex: 0,
        indicatorId: "realGdp",
      }),
    ).toEqual({
      causes: [],
      completeness: "legacy-incomplete",
      missing: "report",
    });
  });

  it("exposes a recorded zero change and distinguishes the initial snapshot", () => {
    const saved: MonthlyReportSnapshot = {
      ...report(1),
      causalTrace: {
        completeness: "complete",
        indicators: [
          stage({
            beforeValue: 100,
            afterValue: 100,
            totalDelta: 0,
            contributions: [],
          }),
        ],
      },
    };
    expect(
      selectReportCauses(game(saved), {
        monthIndex: 1,
        indicatorId: "realGdp",
      }),
    ).toMatchObject({
      completeness: "complete",
      beforeValue: 100,
      afterValue: 100,
      totalDelta: 0,
      contributionSum: 0,
    });
    const initialReport: MonthlyReportSnapshot = {
      ...report(0),
      causalTrace: { completeness: "initial", indicators: [] },
    };
    expect(
      selectReportCauses(game(initialReport), {
        monthIndex: 0,
        indicatorId: "realGdp",
      }),
    ).toMatchObject({ completeness: "initial", causes: [] });
  });
});

describe("monthly brief selector", () => {
  it("preserves the relative-change ranking, including a zero previous value", () => {
    const prior = report(0, [], {
      realHouseholdIncome: 0,
      realGdp: 100,
      inflation: 0.02,
      unemployment: 0.05,
      policyTrust: 50,
    });
    const saved = report(1, [], {
      realHouseholdIncome: 2,
      realGdp: 110,
      inflation: 0.019,
      unemployment: 0.06,
      policyTrust: 49,
    });
    const brief = selectMonthlyBrief(game(prior, saved));
    expect(brief.report).toBe(saved);
    expect(brief.prior).toBe(prior);
    expect(brief.indicators.map((item) => item.id)).toEqual([
      "realHouseholdIncome",
      "unemployment",
    ]);
    expect(brief.indicators[0]).toMatchObject({ current: 2, previous: 0 });
  });

  it("pins the comparison and the third-line cause to an older requested month", () => {
    const shown = cause({ delta: 1 });
    const old = report(1, [shown, cause({ delta: -100 })], {
      ...initial.history.reports![0]!.values,
      realGdp: 110,
    });
    const state = game(
      report(0),
      old,
      report(2, [cause({ sourceId: "newer" })], {
        ...old.values,
        unemployment: 0.9,
      }),
    );
    const brief = selectMonthlyBrief(state, 1);
    expect(brief.report).toBe(old);
    expect(brief.prior?.monthIndex).toBe(0);
    expect(brief.cause).toBe(shown);
    expect(brief.indicators[0]).toMatchObject({ id: "realGdp", current: 110 });
  });

  it("preserves the home indicator order when relative changes tie", () => {
    const values = {
      realHouseholdIncome: 100,
      realGdp: 100,
      inflation: 100,
      unemployment: 100,
      policyTrust: 100,
    };
    const current = Object.fromEntries(
      Object.entries(values).map(([id, value]) => [id, value * 2]),
    );
    expect(
      selectMonthlyBrief(
        game(report(0, [], values), report(1, [], current)),
      ).indicators.map((item) => item.id),
    ).toEqual(["realHouseholdIncome", "realGdp"]);
  });

  it("does not synthesize current values for an incomplete old snapshot", () => {
    const prior = report(0, [], { realGdp: 1, realHouseholdIncome: 100 });
    const saved = report(1, [], { realHouseholdIncome: 110 });
    const brief = selectMonthlyBrief(game(prior, saved));
    expect(brief.indicators.map((item) => item.id)).toEqual([
      "realHouseholdIncome",
    ]);
  });

  it("has no comparison before a preceding snapshot exists", () => {
    const saved = report(0);
    expect(selectMonthlyBrief(game(saved))).toEqual({
      report: saved,
      indicators: [],
    });
  });

  it("returns no brief for a missing requested month or absent history", () => {
    expect(selectMonthlyBrief(game(report(2)), 1)).toEqual({ indicators: [] });
    expect(selectMonthlyBrief(game())).toEqual({ indicators: [] });
    const history = { ...initial.history };
    delete history.reports;
    expect(selectMonthlyBrief({ ...initial, history })).toEqual({
      indicators: [],
    });
  });
});

describe("monthly evidence URL references", () => {
  it("round-trips a full saved reason with Unicode and URL punctuation", () => {
    const target: MonthlyEvidenceTarget = {
      monthIndex: 17,
      indicatorId: "industry.製造業.production",
      row: 2,
      cause: cause({
        indicatorId: "industry.製造業.production",
        sourceId: "政策 / 備え?value=a+b&label=#1:%",
        labelKey: "理由.賃金 / 物価?&=",
        delta: -0.0000001,
      }),
    };
    const query = monthlyEvidenceQuery(target);
    expect(parseMonthlyEvidence(query)).toEqual(target);
    expect(parseMonthlyEvidence(`?${query}`)).toEqual(target);
  });

  it("round-trips an indicator row and a neutral third line", () => {
    for (const target of [
      { monthIndex: 0, indicatorId: "realGdp", row: 0 },
      { monthIndex: 1, indicatorId: "inflation", row: 1 },
      { monthIndex: 2, row: 2 },
    ] as const)
      expect(parseMonthlyEvidence(monthlyEvidenceQuery(target))).toEqual(
        target,
      );
  });

  it.each([
    "",
    "row=0",
    "month=&row=0",
    "month=-1&row=0",
    "month=1.5&row=0",
    "month=Infinity&row=0",
    "month=9007199254740992&row=0",
    "month=1",
    "month=1&row=3",
    "month=1&row=0&indicator=",
    "month=1&month=2&row=0",
    "month=1&row=0&row=1",
    "month=1&row=2&sourceId=orphan",
    "month=1&row=2&indicator=realGdp&sourceType=policy",
    "month=1&row=2&sourceType=policy&sourceId=id&labelKey=key&delta=1",
    "month=1&row=2&indicator=realGdp&sourceType=&sourceId=id&labelKey=key&delta=1",
    "month=1&row=2&indicator=realGdp&sourceType=policy&sourceId=&labelKey=key&delta=1",
    "month=1&row=2&indicator=realGdp&sourceType=policy&sourceId=id&labelKey=&delta=1",
    "month=1&row=2&indicator=realGdp&sourceType=policy&sourceId=id&labelKey=key&delta=",
    "month=1&row=2&indicator=realGdp&sourceType=policy&sourceId=id&labelKey=key&delta=NaN",
    "month=1&row=2&indicator=realGdp&sourceType=policy&sourceId=id&labelKey=key&delta=Infinity",
    "month=1&row=2&indicator=realGdp&sourceType=policy&sourceId=id&labelKey=key&delta=1e999",
    "month=1&row=2&indicator=realGdp&sourceType=policy&sourceId=id&labelKey=key&delta=1&delta=2",
  ])(
    "rejects invalid or partial references without losing fields: %s",
    (query) => {
      expect(parseMonthlyEvidence(query)).toBeUndefined();
    },
  );

  it("accepts the largest safe month index", () => {
    expect(parseMonthlyEvidence("month=9007199254740991&row=2")).toEqual({
      monthIndex: Number.MAX_SAFE_INTEGER,
      row: 2,
    });
  });

  it("gives each row a stable focus-return button ID", () => {
    expect(
      [0, 1, 2].map((row) => monthlyBriefButtonId(row as 0 | 1 | 2)),
    ).toEqual([
      "monthly-brief-evidence-0",
      "monthly-brief-evidence-1",
      "monthly-brief-evidence-2",
    ]);
  });
});
