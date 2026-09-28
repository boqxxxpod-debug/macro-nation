import { describe, expect, it } from "vitest";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import {
  forecastRecord,
  learningEntriesForReport,
  schoolLenses,
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
});
