import { describe, expect, it } from "vitest";
import type {
  GameState,
  LearningEntry,
  MonthlyReportSnapshot,
  PolicyDecision,
} from "@macro-nation/domain";
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

function learningState(
  policies: Partial<GameState["policies"]> = {},
): GameState {
  return {
    learningMode: "learning",
    versions: { contentVersion: "1.3.0" },
    policies: {
      active: [],
      reserved: [],
      completed: [],
      cancelled: [],
      ...policies,
    },
  } as unknown as GameState;
}

const causeDecision = {
  policyId: "public-works",
  type: "publicWorks",
  decidedMonth: 0,
  sourceCommandId: "decision-public-works",
} as PolicyDecision;

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

  it.each(["active", "reserved", "completed", "cancelled"] as const)(
    "links the report cause to its %s decision rather than a newer policy",
    (status) => {
      const recentDecision = {
        ...causeDecision,
        policyId: "latest-interest-rate",
        type: "interestRate",
        decidedMonth: 1,
      } as PolicyDecision;
      const state = learningState({
        active: [recentDecision],
        [status]:
          status === "active"
            ? [recentDecision, causeDecision]
            : [causeDecision],
      });
      const before = structuredClone(state);
      const entries = learningEntriesForReport(state, report);
      expect(entries.map((entry) => entry.decisionId)).toEqual(
        Array(4).fill(causeDecision.policyId),
      );
      expect(learningEntryDisplay(entries[2]!, state).concept).toBe(
        "公共事業を選んだ判断",
      );
      expect(state).toEqual(before);
    },
  );

  it.each(["event", "external", "inertia", "random", "combo"] as const)(
    "keeps a %s cause separate from unrelated policy decisions",
    (sourceType) => {
      const state = learningState({ active: [causeDecision] });
      const entries = learningEntriesForReport(state, {
        ...report,
        topCauses: [{ ...report.topCauses[0]!, sourceType }],
      });
      expect(
        entries.every((entry) => !Object.hasOwn(entry, "decisionId")),
      ).toBe(true);
      expect(learningEntryDisplay(entries[2]!, state).concept).toContain(
        "の影響を踏まえた振り返り",
      );
    },
  );

  it("does not substitute another policy for an unresolved or future source", () => {
    const state = learningState({
      active: [{ ...causeDecision, decidedMonth: 2 }],
      reserved: [{ ...causeDecision, policyId: "another-policy" }],
    });
    const entries = learningEntriesForReport(state, report);
    expect(entries.every((entry) => !Object.hasOwn(entry, "decisionId"))).toBe(
      true,
    );
    expect(learningEntryDisplay(entries[2]!, state).concept).toBe(
      "この結果につながった政策判断を振り返る",
    );
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

  it("stores versioned content references and report facts without notebook prose", () => {
    const state = learningState();
    const entries = learningEntriesForReport(state, report);
    const before = structuredClone(entries);
    expect(
      entries.map((entry) => learningEntryDisplay(entry, state).concept),
    ).toEqual([
      "実質GDP",
      "政策が実質GDPに影響する仕組み",
      "この結果につながった政策判断を振り返る",
      "1月目の結果を振り返る",
    ]);
    expect(learningEntryDisplay(entries[0]!, state).evidence).toBe(
      "1月目の実質GDPの変化に、公共事業の政策が+0.2500指数ポイント影響しています。",
    );
    expect(entries).toEqual(before);
    expect(entries[0]).toMatchObject({
      contentVersion: "1.3.0",
      conceptKey: "learning.term",
      evidenceKey: "learning.evidence.contribution",
      cause: report.topCauses[0],
    });
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("concept");
      expect(entry).not.toHaveProperty("evidence");
    }
    expect(learningEntryDisplay(entries[0]!, state).kindLabel).toBe("用語");
  });

  it("reads legacy internal-ID evidence and keeps its saved wording version", () => {
    const state = learningState();
    const entry: LearningEntry = {
      entryId: "old-entry",
      month: 1,
      kind: "decision",
      concept: "無介入の判断",
      evidence: "realGdp / policy:public-works / +0.2500",
      contentVersion: "1.2.0",
      mode: "learning",
    };
    const before = structuredClone(entry);
    expect(learningEntryDisplay(entry, state)).toEqual({
      concept: "政策を加えずに見守った判断",
      evidence:
        "1月目の実質GDPの変化に、公共事業の政策が+0.2500指数ポイント影響しています。",
      kindLabel: "政策の判断",
    });
    expect(entry).toEqual(before);
    expect(
      learningEntryDisplay({ ...entry, contentVersion: "1.3.0" }, state)
        .concept,
    ).toBe("この結果に関係する判断を振り返る");
  });

  it("preserves Japanese prose in older notes and hides opaque fallback IDs", () => {
    const state = learningState();
    const entry: LearningEntry = {
      entryId: "old-japanese-entry",
      month: 3,
      kind: "term",
      concept: "雇用について",
      evidence: "政策と雇用の変化を振り返ります。",
      mode: "learning",
    };
    expect(learningEntryDisplay(entry, state)).toMatchObject({
      concept: entry.concept,
      evidence: entry.evidence,
    });
    expect(
      learningEntryDisplay(
        { ...entry, concept: "opaque", evidence: "opaque" },
        state,
      ),
    ).toMatchObject({
      concept: "経済の変化についての記録",
      evidence: "3月目の結果をもとにした記録です。",
    });
  });

  it("pins new notes to an existing run content version without modifying it", () => {
    const state = {
      ...learningState(),
      versions: { contentVersion: "1.2.0" },
    } as unknown as GameState;
    const entries = learningEntriesForReport(state, report);
    expect(entries.every((entry) => entry.contentVersion === "1.2.0")).toBe(
      true,
    );
    expect(state.versions.contentVersion).toBe("1.2.0");
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
    expect(entry.cause?.delta).toBe(-0.0012);
  });

  it("keeps unrounded evidence until rate units are formatted", () => {
    const state = learningState();
    const entry = learningEntriesForReport(state, {
      ...report,
      topCauses: [
        {
          ...report.topCauses[0]!,
          indicatorId: "inflation",
          delta: 0.00123456,
        },
      ],
    })[0]!;
    expect(entry.cause?.delta).toBe(0.00123456);
    expect(learningEntryDisplay(entry, state).evidence).toContain(
      "+0.1235パーセントポイント",
    );
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
    expect(entry.cause).toMatchObject({
      indicatorId: "customRate",
      delta: 0.0012,
    });
  });

  it("keeps old school descriptions for an existing content version", () => {
    expect(schoolLensesForContentVersion("1.1.0")).toEqual(schoolLenses);
    const current = schoolLensesForContentVersion("1.2.0");
    expect(schoolLensesForContentVersion("1.3.0")).toEqual(current);
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
