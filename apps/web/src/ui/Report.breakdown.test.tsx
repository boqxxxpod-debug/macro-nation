import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CausalContribution,
  GameState,
  MonthlyReportSnapshot,
} from "@macro-nation/domain";
import { createGame } from "../application/game-service";
import type { MonthlyEvidenceTarget } from "../application/monthly-evidence";
import { Report } from "./GameViews";

vi.mock("../infrastructure/ai", () => ({
  createBrowserAIService: () => ({ news: vi.fn() }),
}));

let initial: GameState;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "issue-119-report-ui",
  );
});
afterEach(cleanup);

function contribution(
  indicatorId: CausalContribution["indicatorId"],
  beforeValue: number,
  deltas: readonly number[],
): CausalContribution {
  const totalDelta = deltas.reduce((sum, value) => sum + value, 0);
  return {
    indicatorId,
    beforeValue,
    afterValue: beforeValue + totalDelta,
    totalDelta,
    contributions: deltas.map((delta, index) => ({
      sourceType: "external",
      sourceId: `${indicatorId}-saved-${index}`,
      labelKey: `test.cause.${index}`,
      confidence: "high",
      delta,
    })),
    diagnostics: [],
  };
}

function report(monthIndex = 1): MonthlyReportSnapshot {
  const indicators = [
    contribution(
      "realGdp",
      monthIndex === 1 ? 100 : 101,
      [0.01, -0.005, 0.003, 0.0001],
    ),
    contribution("inflation", 0.02, [0.00003, -0.00001, 0.000004, 0.000001]),
    contribution("support", 50, [-0.1, 0.02]),
    contribution("politicalCapital", 60, [5]),
  ];
  return {
    monthIndex,
    values: Object.fromEntries(
      indicators.map((item) => [item.indicatorId, item.afterValue]),
    ),
    // Large cross-indicator values must never crowd GDP out of its own list.
    topCauses: [
      {
        indicatorId: "politicalCapital",
        sourceType: "inertia",
        sourceId: "larger-other-metric",
        labelKey: "other.metric",
        delta: 5,
      },
    ],
    causalTrace: { completeness: "complete", indicators },
  };
}

function stateWith(...reports: MonthlyReportSnapshot[]): GameState {
  return {
    ...initial,
    monthIndex: reports.at(-1)?.monthIndex ?? 0,
    learningMode: "learning",
    history: { ...initial.history, reports },
  };
}

function causeIds(container: HTMLElement) {
  return [...container.querySelectorAll("[data-report-cause]")].map((element) =>
    element.getAttribute("data-report-cause"),
  );
}

describe("saved per-indicator report breakdown", () => {
  it("shows the selected metric's top three, expands every saved cause and preserves small inflation effects", () => {
    const state = stateWith(report());
    const before = structuredClone(state);
    const { container } = render(<Report state={state} />);
    expect(causeIds(container)).toEqual([
      "realGdp-saved-0",
      "realGdp-saved-1",
      "realGdp-saved-2",
    ]);
    expect(container.querySelector("[data-report-summary]")).toHaveTextContent(
      "因果記録の前値：100指数 → 後値：100.0081指数",
    );
    expect(container.querySelector("[data-report-total]")).toHaveTextContent(
      "記録された変化：+0.0081指数、保存済み寄与の合計：+0.0081指数",
    );
    expect(screen.getByText(/合計の照合：一致/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "保存された寄与をすべて表示（4件）" }),
    );
    expect(causeIds(container)).toEqual([
      "realGdp-saved-0",
      "realGdp-saved-1",
      "realGdp-saved-2",
      "realGdp-saved-3",
    ]);
    fireEvent.change(screen.getByRole("combobox", { name: "報告の指標" }), {
      target: { value: "inflation" },
    });
    expect(causeIds(container)).toEqual([
      "inflation-saved-0",
      "inflation-saved-1",
      "inflation-saved-2",
    ]);
    expect(container.querySelector("[data-report-summary]")).toHaveTextContent(
      "因果記録の前値：2% → 後値：2.0025%",
    );
    expect(container.querySelector("[data-report-total]")).toHaveTextContent(
      "+0.0025パーセントポイント",
    );
    expect(
      container.querySelector('[data-report-cause="inflation-saved-2"]'),
    ).toHaveTextContent("+0.0004パーセントポイント");
    fireEvent.change(screen.getByRole("combobox", { name: "報告の指標" }), {
      target: { value: "support" },
    });
    expect(causeIds(container)).toEqual(["support-saved-0", "support-saved-1"]);
    expect(state).toEqual(before);
  });

  it("keeps the casual mode's single initial cause and still makes all saved causes available", () => {
    const { container } = render(
      <Report state={{ ...stateWith(report()), learningMode: "casual" }} />,
    );
    expect(causeIds(container)).toEqual(["realGdp-saved-0"]);
    fireEvent.click(
      screen.getByRole("button", { name: "保存された寄与をすべて表示（4件）" }),
    );
    expect(causeIds(container)).toHaveLength(4);
  });

  it("uses the URL target after back navigation and keeps an explicit local month while time advances", () => {
    const state = stateWith(report(1), report(2));
    const target: MonthlyEvidenceTarget = {
      monthIndex: 1,
      indicatorId: "realGdp",
      row: 0,
    };
    const onSelectEvidence = vi.fn();
    const { container, rerender } = render(
      <Report
        state={state}
        evidenceTarget={target}
        onSelectEvidence={onSelectEvidence}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "報告の月" }), {
      target: { value: "2" },
    });
    expect(onSelectEvidence).toHaveBeenCalledWith({
      monthIndex: 2,
      indicatorId: "realGdp",
      row: 0,
    });
    rerender(
      <Report
        state={state}
        evidenceTarget={{ ...target, monthIndex: 2 }}
        onSelectEvidence={onSelectEvidence}
      />,
    );
    expect(container.querySelector("[data-report-summary]")).toHaveTextContent(
      "因果記録の前値：101指数",
    );
    rerender(
      <Report
        state={state}
        evidenceTarget={target}
        onSelectEvidence={onSelectEvidence}
      />,
    );
    expect(screen.getByRole("combobox", { name: "報告の月" })).toHaveValue("1");
    expect(container.querySelector("[data-report-summary]")).toHaveTextContent(
      "因果記録の前値：100指数",
    );
    rerender(
      <Report
        state={stateWith(report(1), report(2), report(3))}
        evidenceTarget={target}
        onSelectEvidence={onSelectEvidence}
      />,
    );
    expect(screen.getByRole("combobox", { name: "報告の月" })).toHaveValue("1");
  });

  it("distinguishes retained legacy causes from a full log and never fills missing values from today's economy", () => {
    const legacy: MonthlyReportSnapshot = {
      monthIndex: 1,
      values: { realGdp: 88 },
      topCauses: report().topCauses,
      causalTrace: { completeness: "legacy-incomplete", indicators: [] },
    };
    const state = stateWith(legacy, report(2));
    const { container, rerender } = render(
      <Report
        state={state}
        evidenceTarget={{ monthIndex: 1, indicatorId: "inflation", row: 0 }}
      />,
    );
    expect(screen.getByText(/旧形式の記録で/)).toBeInTheDocument();
    expect(
      screen.getByText("この月の指標値は保存されていません。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "この月の保存済み報告には、この指標の因果記録がありません。",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-report-summary]")).toBeNull();
    expect(container.querySelector("[data-report-total]")).toBeNull();
    expect(causeIds(container)).toEqual([]);
    rerender(
      <Report
        state={state}
        evidenceTarget={{ monthIndex: 1, indicatorId: "realGdp", row: 0 }}
      />,
    );
    expect(container.querySelector("[data-report-summary]")).toHaveTextContent(
      "この月の値：88指数",
    );
    expect(container.querySelector("[data-report-total]")).toBeNull();
  });

  it("preserves the exact third-row cause and offers all contributions for that same metric", () => {
    const state = stateWith(report());
    const cause = {
      indicatorId: "realGdp",
      ...report().causalTrace!.indicators[0]!.contributions[1]!,
    };
    const target: MonthlyEvidenceTarget = {
      monthIndex: 1,
      indicatorId: "realGdp",
      row: 2,
      cause,
    };
    const onSelectEvidence = vi.fn();
    const { container, rerender } = render(
      <Report
        state={state}
        evidenceTarget={target}
        onSelectEvidence={onSelectEvidence}
      />,
    );
    expect(causeIds(container)).toEqual(["realGdp-saved-1"]);
    fireEvent.click(
      screen.getByRole("button", { name: "この指標の全内訳を見る" }),
    );
    const next: MonthlyEvidenceTarget = {
      monthIndex: 1,
      indicatorId: "realGdp",
      row: 0,
    };
    expect(onSelectEvidence).toHaveBeenCalledWith(next);
    rerender(
      <Report
        state={state}
        evidenceTarget={next}
        onSelectEvidence={onSelectEvidence}
      />,
    );
    expect(causeIds(container)).toEqual([
      "realGdp-saved-0",
      "realGdp-saved-1",
      "realGdp-saved-2",
      "realGdp-saved-3",
    ]);
  });
});
