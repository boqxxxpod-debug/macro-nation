import { describe, expect, it } from "vitest";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import { learningEntriesForReport, visibleCauseCount } from "./learning";

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
});
