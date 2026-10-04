import { describe, expect, it } from "vitest";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import {
  forecastRecord,
  learningEntriesForReport,
  learningEntryDisplay,
  schoolLenses,
  schoolLensesForContentVersion,
  visibleCauseCount,
} from "./learning";

const report: MonthlyReportSnapshot = {
  monthIndex: 1,
  values: {},
  topCauses: [
    {
      indicatorId: "realGdp",
      sourceType: "policy",
      sourceId: "public-works",
      labelKey: "cause.publicWorks",
      delta: 0.25,
    },
  ],
};

describe("learning projection", () => {
  it("changes explanation density without changing its source report", () => {
    expect(visibleCauseCount("casual")).toBe(1);
    expect(visibleCauseCount("standard")).toBe(3);
    expect(visibleCauseCount("learning")).toBe(3);
  });

  it("records the four notebook entry kinds only in learning mode", () => {
    const base = {
      learningMode: "learning",
      policies: { active: [], reserved: [] },
    } as unknown as GameState;
    expect(
      learningEntriesForReport(base, report).map((item) => item.kind),
    ).toEqual(["term", "theory", "decision", "verification"]);
    expect(
      learningEntriesForReport({ ...base, learningMode: "standard" }, report),
    ).toEqual([]);
  });

  it("presents schools as parallel lenses without scores or correct answers", () => {
    expect(schoolLenses.map((lens) => lens.schoolId)).toEqual([
      "liberalism",
      "socialism",
      "neoliberalism",
      "marxism",
      "communism",
    ]);
    for (const lens of schoolLenses) {
      expect(lens.goals.length).toBeGreaterThan(0);
      expect(lens.premises.length).toBeGreaterThan(0);
      expect(lens.benefits.length).toBeGreaterThan(0);
      expect(lens.risks.length).toBeGreaterThan(0);
      expect(lens).not.toHaveProperty("score");
      expect(lens).not.toHaveProperty("correct");
    }
  });

  it("captures common one and five year values for all selected experts", () => {
    expect(
      forecastRecord({
        decisionId: "decision-1",
        month: 3,
        expertIds: ["macro", "fiscal"],
        confidence: "medium",
        uncertainty: "external demand",
        summaries: [
          { horizonMonths: 12, indicatorId: "realGdp", endDelta: 1.2 },
          { horizonMonths: 60, indicatorId: "realGdp", endDelta: 2.4 },
          { horizonMonths: 3, indicatorId: "realGdp", endDelta: 0.2 },
        ],
      }),
    ).toEqual({
      recordId: "forecast:decision-1",
      decisionId: "decision-1",
      recordedMonth: 3,
      expertIds: ["macro", "fiscal"],
      confidence: "medium",
      uncertainty: "external demand",
      horizons: [
        { months: 12, indicators: { realGdp: 1.2 } },
        { months: 60, indicators: { realGdp: 2.4 } },
      ],
    });
  });

  it("translates saved notebook evidence without replacing IDs, values or references", () => {
    const state = {
      learningMode: "learning",
      policies: { active: [], reserved: [], completed: [], cancelled: [] },
    } as unknown as GameState;
    const entries = learningEntriesForReport(state, report);
    const before = structuredClone(entries);
    expect(
      entries.map((entry) => learningEntryDisplay(entry, state).concept),
    ).toEqual([
      "実質GDP",
      "政策が実質GDPに影響する仕組み",
      "政策を加えずに見守った判断",
      "1月目の結果を振り返る",
    ]);
    expect(learningEntryDisplay(entries[0]!, state).evidence).toBe(
      "1月目の実質GDPの変化に、公共事業の政策が+0.2500指数ポイント影響しています。",
    );
    expect(entries).toEqual(before);
    expect(entries[0]?.evidence).toBe(
      "realGdp / policy:public-works / +0.2500",
    );
  });

  it("keeps rate contributions distinct from percent changes and preserves the sign", () => {
    const state = {
      learningMode: "learning",
      policies: { active: [], reserved: [], completed: [], cancelled: [] },
    } as unknown as GameState;
    const entry = learningEntriesForReport(state, {
      ...report,
      topCauses: [
        { ...report.topCauses[0]!, indicatorId: "inflation", delta: -0.0012 },
      ],
    })[0]!;
    expect(learningEntryDisplay(entry, state).evidence).toContain("物価上昇率");
    expect(learningEntryDisplay(entry, state).evidence).toContain(
      "-0.1200パーセントポイント",
    );
    expect(entry.evidence).toContain("-0.0012");
  });

  it("uses the saved unit definition for an added indicator rather than a current default", () => {
    const state = {
      learningMode: "learning",
      policies: { active: [], reserved: [], completed: [], cancelled: [] },
      configSnapshot: {
        normalizedConfig: {
          content: {
            indicatorDefinitions: [
              { indicatorId: "customRate", unit: "PercentRate" },
            ],
          },
        },
      },
    } as unknown as GameState;
    const entry = learningEntriesForReport(state, {
      ...report,
      topCauses: [
        { ...report.topCauses[0]!, indicatorId: "customRate", delta: 0.0012 },
      ],
    })[0]!;
    expect(learningEntryDisplay(entry, state).evidence).toContain(
      "+0.1200パーセントポイント",
    );
    expect(entry.evidence).toBe("customRate / policy:public-works / +0.0012");
  });

  it("keeps old school descriptions for an existing content version", () => {
    expect(schoolLensesForContentVersion("1.1.0")).toEqual(schoolLenses);
    const current = schoolLensesForContentVersion("1.2.0");
    expect(current.map((lens) => lens.schoolId)).toEqual(
      schoolLenses.map((lens) => lens.schoolId),
    );
    expect(current.map((lens) => lens.goals)).toEqual(
      schoolLenses.map((lens) => lens.goals),
    );
    expect(current[0]?.view).toBe(
      "選択の幅と、公正な競争の機会が広がるかを考えます。",
    );
    expect(schoolLensesForContentVersion("1.0.0")[0]?.view).toBe(
      "選択の余地と公正な競争を広げるかを問います。",
    );
  });
});
