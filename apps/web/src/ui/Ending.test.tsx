import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import { createGame } from "../application/game-service";
import { createReservedPolicy } from "../application/policy-view";
import { selectMonthlyEvidence } from "../application/monthly-evidence";
import { Ending } from "./Ending";

vi.mock("./PageDeck", () => ({
  PageDeck: ({
    label,
    children,
    actions,
  }: {
    label: string;
    children: ReactNode;
    actions?: ReactNode;
  }) => (
    <section aria-label={label}>
      {children}
      {actions}
    </section>
  ),
}));

let initial: GameState;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "issue-90-ending-copy",
  );
});
afterEach(cleanup);

describe("ending wording", () => {
  it.each(["completed", "failed"] as const)(
    "distinguishes %s from the other ending reason",
    (runState) => {
      const onReport = vi.fn();
      render(<Ending state={{ ...initial, runState }} onReport={onReport} />);
      expect(screen.getByRole("status").textContent).toMatchSnapshot();
      if (runState === "completed") {
        expect(screen.getByRole("status")).toHaveTextContent(
          `${initial.clock.endMonth}か月の運営期間`,
        );
        expect(screen.getByRole("status")).not.toHaveTextContent("危機のため");
      } else {
        expect(screen.getByRole("status")).toHaveTextContent(
          "危機のため国家運営を終了しました",
        );
        expect(screen.getByRole("status")).not.toHaveTextContent(
          "運営期間を終えました",
        );
        expect(
          screen.getByRole("heading", { name: "総合評価：F" }),
        ).toBeInTheDocument();
      }
      fireEvent.click(screen.getByRole("button", { name: "変化の理由を見る" }));
      expect(onReport).toHaveBeenCalledOnce();
      expect(onReport.mock.calls).toEqual([[]]);
    },
  );

  it("explains saved decisions and causes without exposing IDs or changing the state", () => {
    const policy = createReservedPolicy(
      initial,
      "interest-rate",
      0.05,
      "private-ending-policy",
      0,
    );
    const first = initial.history.reports![0]!;
    const state: GameState = {
      ...initial,
      runState: "failed",
      monthIndex: 2,
      policies: { ...initial.policies, reserved: [policy] },
      history: {
        ...initial.history,
        reports: [
          first,
          {
            ...first,
            monthIndex: 2,
            values: { ...first.values, realGdp: 110 },
            causalTrace: { completeness: "legacy-incomplete", indicators: [] },
            topCauses: [
              {
                indicatorId: "inflation",
                sourceType: "policy",
                sourceId: policy.policyId,
                labelKey: "private-cause-key",
                delta: 0.01,
              },
            ],
          },
        ],
      },
    };
    const before = structuredClone(state);
    const { container } = render(<Ending state={state} onReport={vi.fn()} />);
    expect(container).not.toHaveTextContent(
      /private-ending-policy|private-cause-key|ending:failed|crisis:2/,
    );
    expect(screen.getByText(/^主な判断：/).textContent).toMatchSnapshot();
    expect(
      screen.getByText(/^危機につながったこと：/).textContent,
    ).toMatchSnapshot();
    expect(
      screen.getByRole("region", { name: "期間全体の主な変化" }),
    ).toHaveTextContent("100.0 → 最終 110.0");
    expect(screen.getByText(/^最終月の物価上昇率には/)).toHaveTextContent(
      "政策金利",
    );
    expect(state).toEqual(before);
  });
});

function mismatchState(
  runState: "completed" | "failed" = "completed",
): GameState {
  const reports: MonthlyReportSnapshot[] = [
    {
      monthIndex: 0,
      values: { exports: 25, governmentDebt: 1080 },
      topCauses: [],
    },
    {
      monthIndex: 47,
      values: { exports: 20, governmentDebt: 1069.84 },
      topCauses: [
        {
          indicatorId: "exports",
          sourceType: "external",
          sourceId: "external.export-demand",
          labelKey: "private-export-cause",
          delta: -0.5,
        },
      ],
    },
    {
      monthIndex: 48,
      values: { exports: 19, governmentDebt: 1081 },
      topCauses: [
        {
          indicatorId: "governmentDebt",
          sourceType: "accounting",
          sourceId: "fiscal.debt",
          labelKey: "private-debt-cause",
          delta: 11.16,
        },
      ],
    },
  ];
  return {
    ...initial,
    runState,
    monthIndex: 48,
    history: { ...initial.history, reports },
  };
}

describe("ending evidence periods", () => {
  it.each(["completed", "failed"] as const)(
    "separates the whole-period exports change from the final-month debt cause for %s",
    (runState) => {
      const state = mismatchState(runState);
      const before = structuredClone(state);
      const onReport = vi.fn();
      const { container } = render(
        <Ending state={state} onReport={onReport} />,
      );
      const period = screen.getByRole("region", { name: "期間全体の主な変化" });
      const finalMonth = screen.getByRole("region", {
        name: "最終月に大きく影響したこと",
      });
      expect(
        within(period).getByRole("heading", { name: "期間全体の主な変化" }),
      ).toBeInTheDocument();
      expect(period).toHaveTextContent("輸出");
      expect(period).toHaveTextContent("25.0 → 最終 19.0");
      expect(period).toHaveAttribute("data-ending-period-start", "0");
      expect(period).toHaveAttribute("data-ending-period-end", "48");
      expect(period).not.toHaveTextContent(/11\.16|税収・支出と債務/);
      expect(period).toHaveTextContent(/期間全体.*因果記録.*ありません/);
      expect(period).toHaveTextContent(/月次.*期間全体.*理由/);
      expect(finalMonth).toHaveTextContent(/政府債務/);
      expect(finalMonth).toHaveTextContent(/47月目.*48月目/);
      expect(finalMonth).toHaveTextContent("11.16");
      expect(finalMonth).toHaveTextContent("税収・支出と債務");
      expect(finalMonth).not.toHaveTextContent(/輸出|25\.0|19\.0/);
      fireEvent.click(
        within(period).getByRole("button", {
          name: "輸出の月次記録を見る（47月目）",
        }),
      );
      expect(onReport).toHaveBeenLastCalledWith({
        monthIndex: 47,
        indicatorId: "exports",
        row: 0,
      });
      expect(
        selectMonthlyEvidence(state, onReport.mock.lastCall![0]).causes,
      ).toEqual(state.history.reports![1]!.topCauses);
      fireEvent.click(
        within(finalMonth).getByRole("button", {
          name: "最終月の要因をレポートで見る",
        }),
      );
      expect(onReport).toHaveBeenLastCalledWith({
        monthIndex: 48,
        indicatorId: "governmentDebt",
        row: 0,
      });
      expect(
        selectMonthlyEvidence(state, onReport.mock.lastCall![0]).causes,
      ).toEqual(state.history.reports![2]!.topCauses);
      expect(container).not.toHaveTextContent(
        /private-export-cause|private-debt-cause|external\.export-demand|fiscal\.debt/,
      );
      expect(state).toEqual(before);
    },
  );

  it("retains both dated targets after a JSON reload", () => {
    const state: GameState = JSON.parse(JSON.stringify(mismatchState()));
    const before = JSON.stringify(state);
    const onReport = vi.fn();
    render(<Ending state={state} onReport={onReport} />);
    fireEvent.click(
      screen.getByRole("button", { name: "輸出の月次記録を見る（47月目）" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "最終月の要因をレポートで見る" }),
    );
    expect(onReport.mock.calls).toEqual([
      [{ monthIndex: 47, indicatorId: "exports", row: 0 }],
      [{ monthIndex: 48, indicatorId: "governmentDebt", row: 0 }],
    ]);
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each([
    "no reports",
    "no initial endpoint",
    "no final endpoint",
    "no common finite values",
  ] as const)(
    "does not invent a zero endpoint or unrelated comparison with %s",
    (reason) => {
      const reports: readonly MonthlyReportSnapshot[] =
        reason === "no reports"
          ? []
          : reason === "no initial endpoint"
            ? mismatchState().history.reports!.slice(1)
            : reason === "no final endpoint"
              ? mismatchState().history.reports!.slice(0, 2)
              : [
                  { monthIndex: 0, values: { exports: 25 }, topCauses: [] },
                  {
                    monthIndex: 48,
                    values: { governmentDebt: 1081 },
                    topCauses: [],
                  },
                ];
      const state: GameState = {
        ...mismatchState(),
        history: { ...initial.history, reports },
      };
      const before = structuredClone(state);
      render(<Ending state={state} onReport={vi.fn()} />);
      const period = screen.getByRole("region", { name: "期間全体の主な変化" });
      expect(period).not.toHaveTextContent(/開始.*→.*最終/);
      expect(
        within(period).queryByRole("button", { name: /月次記録を見る/ }),
      ).not.toBeInTheDocument();
      expect(period).toHaveTextContent(/保存|記録/);
      const finalMonth = screen.getByRole("region", {
        name: "最終月に大きく影響したこと",
      });
      if (!reports.some((report) => report.monthIndex === 48)) {
        expect(finalMonth).not.toHaveTextContent(/税収・支出と債務|11\.16/);
        expect(
          within(finalMonth).queryByRole("button", {
            name: "最終月の要因をレポートで見る",
          }),
        ).not.toBeInTheDocument();
      }
      expect(state).toEqual(before);
    },
  );

  it("keeps an exports target when that metric has no causes and never substitutes the debt cause", () => {
    const state = mismatchState();
    const reports = state.history.reports!.map((report) =>
      report.monthIndex === 47 ? { ...report, topCauses: [] } : report,
    );
    const onReport = vi.fn();
    render(
      <Ending
        state={{ ...state, history: { ...state.history, reports } }}
        onReport={onReport}
      />,
    );
    const period = screen.getByRole("region", { name: "期間全体の主な変化" });
    expect(period).toHaveTextContent("表示できる月次の理由がありません。");
    expect(period).not.toHaveTextContent("税収・支出と債務");
    fireEvent.click(
      within(period).getByRole("button", {
        name: "輸出の月次記録を見る（48月目）",
      }),
    );
    expect(onReport).toHaveBeenLastCalledWith({
      monthIndex: 48,
      indicatorId: "exports",
      row: 0,
    });
    expect(
      selectMonthlyEvidence(
        { ...state, history: { ...state.history, reports } },
        onReport.mock.lastCall![0],
      ).missing,
    ).toBe("cause");
  });

  it("shows a missing final-month cause without borrowing an older month's export cause", () => {
    const state = mismatchState();
    const reports = state.history.reports!.map((report) =>
      report.monthIndex === 48 ? { ...report, topCauses: [] } : report,
    );
    render(
      <Ending
        state={{ ...state, history: { ...state.history, reports } }}
        onReport={vi.fn()}
      />,
    );
    const finalMonth = screen.getByRole("region", {
      name: "最終月に大きく影響したこと",
    });
    expect(finalMonth).toHaveTextContent("表示できる月次の理由がありません。");
    expect(finalMonth).not.toHaveTextContent(/輸出|為替・貿易/);
    expect(
      within(finalMonth).queryByRole("button", {
        name: "最終月の要因をレポートで見る",
      }),
    ).not.toBeInTheDocument();
  });
});
