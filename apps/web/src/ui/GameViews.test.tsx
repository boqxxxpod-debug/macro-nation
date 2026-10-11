import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ConfigSnapshot, GameState } from "@macro-nation/domain";
import { percentRate, scorePoint, stockLevel } from "@macro-nation/domain";
import {
  expertPortraitManifest,
  expertProfilesForContentVersion,
} from "@macro-nation/advisor-core";
import { PreviewClient } from "../infrastructure/preview-client";
import type { PreviewOutput } from "../application/policy-view";
import { createGame } from "../application/game-service";
import { learningEntriesForReport } from "../application/learning";
import { createReservedPolicy, policyRules } from "../application/policy-view";
import {
  Home,
  PolicyForm,
  Preview,
  Report,
  type PolicyFormDraftState,
} from "./GameViews";
import { display, label } from "./game-format";

// Copy projections are tested in full; App and PageDeck tests cover pagination.
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
const { news } = vi.hoisted(() => ({ news: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({
  createBrowserAIService: () => ({ news }),
}));

let initial: GameState;
let output: PreviewOutput;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "issue-90-screen-copy",
  );
  output = await new PreviewClient(null).request({
    state: initial,
    draft: {
      status: "draft",
      policyId: "private-draft-id",
      ruleId: "interest-rate",
      value: 0.05,
      quartersAhead: 0,
    },
    horizonMonths: 60,
  });
});
afterEach(() => {
  cleanup();
  news.mockReset();
});

function reportState(): GameState {
  const policy = createReservedPolicy(
    initial,
    "interest-rate",
    0.05,
    "private-policy-id",
    0,
  );
  const report = {
    ...initial.history.reports![0]!,
    monthIndex: 1,
    topCauses: [
      {
        indicatorId: "inflation",
        sourceType: "policy",
        sourceId: policy.policyId,
        labelKey: "policy.rate",
        delta: 0.01,
      },
    ],
  };
  const state: GameState = {
    ...initial,
    monthIndex: 1,
    policies: { ...initial.policies, reserved: [policy] },
    history: {
      ...initial.history,
      reports: [...initial.history.reports!, report],
      forecastRecords: [
        {
          recordId: "private-forecast-id",
          decisionId: policy.policyId,
          recordedMonth: 1,
          expertIds: ["macro"],
          confidence: "medium",
          uncertainty: output.uncertainty.note,
          horizons: [
            { months: 12, indicators: { realGdp: 1 } },
            { months: 60, indicators: { realGdp: 2 } },
          ],
        },
      ],
    },
  };
  return {
    ...state,
    history: {
      ...state.history,
      learningEntries: learningEntriesForReport(state, report),
    },
  };
}

describe("game screen wording", () => {
  it.each([
    [
      "interest-rate",
      "政策金利（年率・%）",
      "-2〜30%",
      "5",
      0.05,
      "+3ポイント（引き上げ）",
    ],
    [
      "tax-package",
      "税負担の変更幅（ポイント）",
      "-5〜5ポイント",
      "-3",
      -0.03,
      "-3ポイント（減税方向）",
    ],
    [
      "public-works",
      "公共事業の追加規模（年間GDP比・%）",
      "0〜8%",
      "4",
      0.04,
      "+4ポイント（追加投資を拡大）",
    ],
    [
      "tariff",
      "関税率（%）",
      "0〜100%",
      "25",
      0.25,
      "+25ポイント（関税を引き上げ）",
    ],
    [
      "fx-intervention",
      "為替介入の規模（年間GDP比・%）",
      "-5〜5%",
      "-2",
      -0.02,
      "-2ポイント（自国通貨売り・外貨準備が増加）",
    ],
  ] as const)(
    "%s explains its unit, range and direction while preserving the decimal draft",
    (ruleId, name, range, displayed, internal, direction) => {
      const onPreview = vi.fn();
      render(<PolicyForm state={initial} onPreview={onPreview} busy={false} />);
      fireEvent.change(screen.getByRole("combobox", { name: "政策の種類" }), {
        target: { value: ruleId },
      });
      const input = screen.getByRole("spinbutton", { name });
      expect(input).toHaveAttribute("min");
      expect(input).toHaveAttribute("max");
      const description = input
        .getAttribute("aria-describedby")!
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      expect(description).toContain(range);
      fireEvent.change(input, { target: { value: displayed } });
      expect(input).toHaveValue(Number(displayed));
      expect(
        screen.getByText((text) => text.includes(direction)),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "見通しを確認" }));
      expect(onPreview).toHaveBeenCalledWith(
        expect.objectContaining({ ruleId, value: internal }),
        ["macro"],
      );
    },
  );

  it("compares interest to the live rate while identifying its separate model reference", () => {
    render(
      <PolicyForm
        state={{
          ...initial,
          economy: {
            ...initial.economy,
            rates: { ...initial.economy.rates, policyRate: percentRate(0.035) },
          },
        }}
        onPreview={vi.fn()}
        busy={false}
      />,
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "政策金利（年率・%）" }),
      {
        target: { value: "4" },
      },
    );
    expect(
      screen.getByText(/現在の政策金利 3.5%から \+0.5ポイント/),
    ).toBeInTheDocument();
    expect(screen.getByText("効果計算の基準値は2%です。")).toBeInTheDocument();
  });

  it.each(["3.5", "2.12345678901234"])(
    "keeps entered %s%% across draft restoration without rounding the submitted value",
    (displayed) => {
      const onPreview = vi.fn();
      const onDraftChange = vi.fn<(draft: PolicyFormDraftState) => void>();
      const view = render(
        <PolicyForm
          state={initial}
          onPreview={onPreview}
          onDraftChange={onDraftChange}
          busy={false}
        />,
      );
      const input = screen.getByRole("spinbutton", {
        name: "政策金利（年率・%）",
      });
      fireEvent.change(input, { target: { value: displayed } });
      expect(input).toHaveValue(Number(displayed));
      expect(input).toHaveAttribute("value", displayed);
      const rememberedDraft = onDraftChange.mock.calls.at(-1)![0];
      view.unmount();
      render(
        <PolicyForm
          state={initial}
          onPreview={onPreview}
          draftState={rememberedDraft}
          busy={false}
        />,
      );
      expect(
        screen.getByRole("spinbutton", { name: "政策金利（年率・%）" }),
      ).toHaveAttribute("value", displayed);
      fireEvent.click(screen.getByRole("button", { name: "見通しを確認" }));
      expect(onPreview).toHaveBeenCalledWith(
        expect.objectContaining({ value: Number(displayed) / 100 }),
        ["macro"],
      );
    },
  );

  it("resets the displayed value and baseline when switching from a rate to a change amount", () => {
    render(<PolicyForm state={initial} onPreview={vi.fn()} busy={false} />);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "政策金利（年率・%）" }),
      { target: { value: "3.5" } },
    );
    fireEvent.change(screen.getByRole("combobox", { name: "政策の種類" }), {
      target: { value: "tax-package" },
    });
    expect(
      screen.getByRole("spinbutton", { name: "税負担の変更幅（ポイント）" }),
    ).toHaveValue(0);
    expect(
      screen.getByText(/税負担の変更なしを表す基準 0ポイント/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/現在の政策金利/)).not.toBeInTheDocument();
  });

  it.each([
    ["interest-rate", "政策金利（年率・%）", -2, 30, -0.02, 0.3],
    ["tax-package", "税負担の変更幅（ポイント）", -5, 5, -0.05, 0.05],
    ["public-works", "公共事業の追加規模（年間GDP比・%）", 0, 8, 0, 0.08],
    ["tariff", "関税率（%）", 0, 100, 0, 1],
    ["fx-intervention", "為替介入の規模（年間GDP比・%）", -5, 5, -0.05, 0.05],
  ] as const)(
    "%s accepts its unchanged configured boundaries in display units",
    (ruleId, name, min, max, internalMin, internalMax) => {
      const onPreview = vi.fn();
      render(<PolicyForm state={initial} onPreview={onPreview} busy={false} />);
      fireEvent.change(screen.getByRole("combobox", { name: "政策の種類" }), {
        target: { value: ruleId },
      });
      const input = screen.getByRole("spinbutton", { name });
      expect(input).toHaveAttribute("min", String(min));
      expect(input).toHaveAttribute("max", String(max));
      for (const [displayed, internal] of [
        [min, internalMin],
        [max, internalMax],
      ]) {
        fireEvent.change(input, { target: { value: String(displayed) } });
        expect(
          screen.getByRole("button", { name: "見通しを確認" }),
        ).toBeEnabled();
        fireEvent.click(screen.getByRole("button", { name: "見通しを確認" }));
        expect(onPreview).toHaveBeenLastCalledWith(
          expect.objectContaining({ ruleId, value: internal }),
          ["macro"],
        );
      }
    },
  );

  it("keeps an empty or out-of-range percentage invalid instead of treating it as zero", () => {
    const onPreview = vi.fn();
    render(<PolicyForm state={initial} onPreview={onPreview} busy={false} />);
    const input = screen.getByRole("spinbutton", {
      name: "政策金利（年率・%）",
    });
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);
    expect(screen.getByRole("button", { name: "見通しを確認" })).toBeDisabled();
    expect(
      screen.getByText(/政策金利（年率・%）は-2〜30%の範囲/),
    ).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "31" } });
    expect(input).toHaveValue(31);
    expect(screen.getByRole("button", { name: "見通しを確認" })).toBeDisabled();
    expect(screen.getByText(/範囲内の値を入力すると/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "見通しを確認" }));
    expect(onPreview).not.toHaveBeenCalled();
  });

  it.each(["paused", "awaitingEvent", "crisisStopped"] as const)(
    "explains the next step for %s on Home",
    (runState) => {
      render(
        <Home
          state={{ ...initial, runState }}
          onOpenReport={vi.fn()}
          onOpenPolicies={vi.fn()}
        />,
      );
      expect(screen.getByRole("status").textContent).toMatchSnapshot();
      expect(
        screen.getByRole("button", { name: "変化の理由を見る" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/月を進めると、変化の理由/)).toBeInTheDocument();
    },
  );

  it("shows event names and preparedness labels while retaining the saved IDs", () => {
    const state = {
      ...initial,
      events: {
        ...initial.events,
        warnings: [
          {
            eventId: "evt-demand-slump",
            severity: 2 as const,
            preparedness: 0.25,
            missingIndicatorIds: ["fiscal-space", "policy-trust"],
          },
        ],
      },
    };
    const before = structuredClone(state);
    const { container } = render(
      <Home state={state} onOpenReport={vi.fn()} onOpenPolicies={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "ホームの詳細" }), {
      target: { value: "warnings" },
    });
    expect(screen.getByText(/準備度 25%/).textContent).toMatchSnapshot();
    expect(
      screen.getByText(/備えが足りない項目/).textContent,
    ).toMatchSnapshot();
    expect(screen.getByText(/備えが足りない項目/)).toHaveTextContent(
      "裁量予算、政策への信頼",
    );
    expect(container).not.toHaveTextContent(
      /evt-demand-slump|fiscal-space|policy-trust/,
    );
    expect(state).toEqual(before);
  });

  it("translates old notebook, forecast and history records without rewriting them", () => {
    const state = reportState();
    const before = structuredClone(state);
    const { container } = render(<Report state={state} />);
    expect(container).not.toHaveTextContent(
      /private-policy-id|private-forecast-id|inflation|interestRate|medium|policy.rate/,
    );
    expect(screen.getByText(/専門家：/).textContent).toMatchSnapshot();
    expect(
      screen.getAllByText(/^根拠：/).map((element) => element.textContent),
    ).toMatchSnapshot();
    expect(screen.getByText(/1年：GDP差/)).toHaveTextContent("1.0");
    expect(state).toEqual(before);
  });

  it("preserves preview values and confirmation while hiding internal IDs", () => {
    const onConfirm = vi.fn();
    const preview = { ...output, interactions: ["private-overlap-policy"] };
    const before = structuredClone(preview);
    const { container, rerender } = render(
      <Preview
        configSnapshot={initial.configSnapshot}
        output={preview}
        counterfactuals={[]}
        expertIds={["macro"]}
        contentVersion={initial.versions.contentVersion}
        busy={false}
        onConfirm={onConfirm}
      />,
    );
    expect(container).not.toHaveTextContent(
      /private-overlap-policy|growth-investment-package|trade-demand-cancellation|snapshot|fixed-shock/,
    );
    expect(
      screen.getAllByRole("heading").map((element) => element.textContent),
    ).toMatchSnapshot();
    const inflation = preview.indicators.find(
      (indicator) => indicator.indicatorId === "inflation",
    )!;
    expect(container).toHaveTextContent(
      display("inflation", inflation.month12.low),
    );
    expect(container).toHaveTextContent(
      display("inflation", inflation.month12.high),
    );
    const confirm = screen.getByRole("button", { name: "政策を確定する" });
    expect(confirm).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "費用・副作用・警告を確認しました",
      }),
    );
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    rerender(
      <Preview
        configSnapshot={initial.configSnapshot}
        output={preview}
        counterfactuals={[]}
        expertIds={["macro"]}
        contentVersion={initial.versions.contentVersion}
        busy
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByRole("button", { name: "政策を保存しています…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: "費用・副作用・警告を確認しました",
      }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "政策を保存しています…" }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(preview).toEqual(before);
  });

  it("places the decision summary and combination warnings before acknowledgement while preserving the detailed views", () => {
    const preview: PreviewOutput = {
      ...output,
      activationMonth: 3,
      primaryEffects: [
        { ...output.primaryEffects[0]!, startMonth: 9 },
        {
          ...output.primaryEffects[0]!,
          effectId: "earlier-effect",
          startMonth: 5,
        },
      ],
      sideEffects: [{ ...output.sideEffects[0]!, startMonth: 8 }],
      indicators: output.indicators.map((indicator) => ({
        ...indicator,
        month12: {
          ...indicator.month12,
          deltaBase:
            indicator.indicatorId === "realGdp"
              ? 1.27
              : indicator.indicatorId === "inflation"
                ? 0.003
                : indicator.indicatorId === "unemployment"
                  ? -0.007
                  : indicator.month12.deltaBase,
        },
      })),
      summaries: output.summaries.map((summary) =>
        summary.indicatorId === "realGdp" && summary.horizonMonths === 12
          ? { ...summary, peakMonth: 7, endDelta: 98 }
          : summary,
      ),
      costs: {
        politicalCapital: 17,
        implementationCapacity: 23,
        foreignReserves: 4.5,
        immediateBudget: 31,
      },
      interactions: ["overlapping-policy-1", "overlapping-policy-2"],
      comboResults: [
        {
          ...output.comboResults[0]!,
          activated: false,
          reason: "insufficient-additional-cost",
          additionalCosts: {
            politicalCapital: 19,
            implementationCapacity: 11,
            foreignReserves: 3,
            immediateBudget: 7,
          },
        },
      ],
      uncertainty: {
        ...output.uncertainty,
        note: "外部需要の変化によって効果の幅が変わります。",
      },
    };
    const before = structuredClone(preview);
    render(
      <Preview
        configSnapshot={initial.configSnapshot}
        output={preview}
        counterfactuals={[]}
        expertIds={["macro"]}
        contentVersion={initial.versions.contentVersion}
        busy={false}
        onConfirm={vi.fn()}
      />,
    );
    const summary = screen.getByRole("region", { name: "判断の要点" });
    expect(
      screen.getByRole("heading", { name: "判断の要点" }),
    ).toBeInTheDocument();
    const timing = within(summary).getByText("時期：").closest("p")!;
    expect(timing).toHaveTextContent("4月目");
    expect(timing).toHaveTextContent("6月目");
    expect(timing).toHaveTextContent("7か月後");
    const differences = within(summary)
      .getByText("現状維持との差（1年後）：")
      .closest("p")!;
    expect(differences).toHaveTextContent(`${label("realGdp")} +1.3`);
    expect(differences).toHaveTextContent(`${label("inflation")} +0.3%`);
    expect(differences).toHaveTextContent(`${label("unemployment")} -0.7%`);
    const costs = within(summary).getByText("費用：").closest("p")!;
    expect(costs).toHaveTextContent("政治資本 17");
    expect(costs).toHaveTextContent("実施能力 23");
    expect(costs).toHaveTextContent("外貨準備 4.5");
    expect(costs).toHaveTextContent("開始予算 31");
    expect(
      within(summary).getByText("副作用：").closest("p"),
    ).toHaveTextContent(label(preview.sideEffects[0]!.targetPath));
    const uncertainty = within(summary).getByText("不確実性：").closest("p")!;
    for (const driver of preview.uncertainty.majorDrivers) {
      expect(uncertainty).toHaveTextContent(label(driver));
    }
    expect(
      within(summary).getByText(preview.uncertainty.note),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText(/同じ種類の政策が2件あります/),
    ).toBeInTheDocument();
    const combination = screen.getByRole("region", {
      name: "政策の組み合わせ",
    });
    expect(combination).toHaveTextContent(
      "組み合わせの追加費用が足りません（政策自体は確定できます）",
    );
    expect(combination).toHaveTextContent(
      "追加費用：政治資本 19、実施能力 11、外貨準備 3、予算 7",
    );
    const acknowledgement = screen.getByRole("checkbox", {
      name: "費用・副作用・警告を確認しました",
    });
    const details = screen.getByRole("heading", {
      name: "新しい政策を加えない場合との12か月比較",
    });
    const forecast = screen.getByRole("region", { name: "1年・5年の見通し" });
    const alternatives = screen.getByRole("region", {
      name: "別の政策を選んだら",
    });
    const advice = screen.getByRole("region", { name: "選択した専門家の解説" });
    for (const [earlier, later] of [
      [summary, combination],
      [combination, acknowledgement],
      [acknowledgement, details],
      [details, forecast],
      [forecast, alternatives],
      [alternatives, advice],
    ]) {
      expect(
        earlier!.compareDocumentPosition(later!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(preview).toEqual(before);
  });

  it.each([
    ["interest-rate", 0.05, "政策金利（年率・%）", "5%"],
    ["tax-package", -0.03, "税負担の変更幅（ポイント）", "-3ポイント"],
    ["public-works", 0.04, "公共事業の追加規模（年間GDP比・%）", "4%"],
    ["tariff", 0.25, "関税率（%）", "25%"],
    ["fx-intervention", -0.02, "為替介入の規模（年間GDP比・%）", "-2%"],
  ] as const)(
    "shows the %s draft in its input units in the decision summary",
    (ruleId, value, settingLabel, settingValue) => {
      const preview: PreviewOutput = {
        ...output,
        previewedDraft: { ...output.previewedDraft!, ruleId, value },
      };
      const before = structuredClone(preview);
      render(
        <Preview
          configSnapshot={initial.configSnapshot}
          output={preview}
          counterfactuals={[]}
          expertIds={["macro"]}
          contentVersion={initial.versions.contentVersion}
          busy={false}
          onConfirm={vi.fn()}
        />,
      );
      const summary = screen.getByRole("region", { name: "判断の要点" });
      const policy = within(summary).getByText("政策案：").closest("p")!;
      expect(policy).toHaveTextContent(label(ruleId));
      expect(policy).toHaveTextContent(settingLabel);
      expect(policy).toHaveTextContent(settingValue);
      expect(preview).toEqual(before);
    },
  );

  it.each([
    ["interest-rate", 0.05, "政策金利（年率・%）", "5%"],
    ["tax-package", -0.03, "税負担の変更幅（ポイント）", "-3ポイント"],
    ["public-works", 0.04, "公共事業の追加規模（年間GDP比・%）", "4%"],
    ["tariff", 0.25, "関税率（%）", "25%"],
    ["fx-intervention", -0.02, "為替介入の規模（年間GDP比・%）", "-2%"],
  ] as const)(
    "uses the configured policy type for %s when policy rule IDs are customized",
    (ruleId, value, settingLabel, settingValue) => {
      const customRuleId = `custom-${ruleId}`;
      const configSnapshot: ConfigSnapshot = {
        ...initial.configSnapshot,
        normalizedConfig: {
          ...initial.configSnapshot.normalizedConfig,
          policyRules: policyRules(initial.configSnapshot).map((rule) => ({
            ...rule,
            policyId: `custom-${rule.policyId}`,
          })),
        },
      };
      const rule = policyRules(configSnapshot).find(
        (candidate) => candidate.policyId === customRuleId,
      )!;
      const preview: PreviewOutput = {
        ...output,
        previewedDraft: {
          ...output.previewedDraft!,
          ruleId: customRuleId,
          value,
        },
      };
      const previewBefore = structuredClone(preview);
      const configBefore = structuredClone(configSnapshot);
      render(
        <Preview
          configSnapshot={configSnapshot}
          output={preview}
          counterfactuals={[]}
          expertIds={["macro"]}
          contentVersion={initial.versions.contentVersion}
          busy={false}
          onConfirm={vi.fn()}
        />,
      );
      const summary = screen.getByRole("region", { name: "判断の要点" });
      const policy = within(summary).getByText("政策案：").closest("p")!;
      expect(policy).toHaveTextContent(label(rule.policyType));
      expect(policy).toHaveTextContent(`${settingLabel}：${settingValue}`);
      expect(policy).not.toHaveTextContent(customRuleId);
      expect(preview).toEqual(previewBefore);
      expect(configSnapshot).toEqual(configBefore);
    },
  );

  it.each(["stateHash", "draftHash"] as const)(
    "requires acknowledgement again when the preview's %s changes",
    (key) => {
      const onConfirm = vi.fn();
      const onBack = vi.fn();
      const props = {
        configSnapshot: initial.configSnapshot,
        counterfactuals: [],
        expertIds: ["macro"],
        contentVersion: initial.versions.contentVersion,
        busy: false,
        onConfirm,
        onBack,
      };
      const { rerender } = render(<Preview {...props} output={output} />);
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: "費用・副作用・警告を確認しました",
        }),
      );
      expect(
        screen.getByRole("button", { name: "政策を確定する" }),
      ).toBeEnabled();
      rerender(<Preview {...props} output={{ ...output }} />);
      expect(
        screen.getByRole("checkbox", {
          name: "費用・副作用・警告を確認しました",
        }),
      ).toBeChecked();
      rerender(
        <Preview {...props} output={{ ...output, [key]: "changed-preview" }} />,
      );
      const acknowledgement = screen.getByRole("checkbox", {
        name: "費用・副作用・警告を確認しました",
      });
      expect(acknowledgement).not.toBeChecked();
      const confirm = screen.getByRole("button", { name: "政策を確定する" });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(onConfirm).not.toHaveBeenCalled();
      fireEvent.click(acknowledgement);
      expect(confirm).toBeEnabled();
      rerender(
        <Preview
          {...props}
          output={{ ...output, [key]: "changed-preview" }}
          busy
        />,
      );
      expect(
        screen.getByRole("checkbox", {
          name: "費用・副作用・警告を確認しました",
        }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "案を修正する" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "案を修正する" }));
      expect(onBack).not.toHaveBeenCalled();
    },
  );

  it("guides the player when no preview exists", () => {
    render(
      <Preview
        configSnapshot={initial.configSnapshot}
        output={null}
        counterfactuals={[]}
        expertIds={["macro"]}
        contentVersion={initial.versions.contentVersion}
        busy={false}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/政策会議で案を作り/).textContent,
    ).toMatchSnapshot();
    expect(screen.getByRole("button", { name: "案を修正する" })).toBeEnabled();
  });

  it("keeps legacy expert profiles while translating indicator IDs in their explanations", () => {
    const { container } = render(
      <Preview
        configSnapshot={initial.configSnapshot}
        output={output}
        counterfactuals={[]}
        expertIds={["macro"]}
        contentVersion="1.1.0"
        busy={false}
        onConfirm={vi.fn()}
      />,
    );
    expect(container).not.toHaveTextContent(
      /realGdp|inflation|unemployment|policyRate|無追加政策比/,
    );
    expect(
      screen.getByText(/景山 めぐみ · 口調：段階を追って教える/),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByText(/新しい政策を加えない場合と比べて/)
        .map((element) => element.textContent),
    ).toMatchSnapshot();
  });

  it("gives a next step for an unaffordable policy", () => {
    render(
      <PolicyForm
        state={{
          ...initial,
          resources: { ...initial.resources, politicalCapital: scorePoint(0) },
        }}
        onPreview={vi.fn()}
        busy={false}
      />,
    );
    expect(
      screen.getAllByRole("status").map((element) => element.textContent),
    ).toMatchSnapshot();
    expect(screen.getByRole("button", { name: "見通しを確認" })).toBeDisabled();
  });

  it("shows the allowed range when a policy value is invalid", () => {
    render(
      <PolicyForm
        state={initial}
        onPreview={vi.fn()}
        busy={false}
        draftState={{
          ruleId: "interest-rate",
          value: 99,
          quartersAhead: 0,
          policyId: "private-invalid-draft",
          expertIds: ["macro"],
        }}
      />,
    );
    expect(
      screen.getAllByRole("status").map((element) => element.textContent),
    ).toMatchSnapshot();
    expect(screen.getByRole("button", { name: "見通しを確認" })).toBeDisabled();
  });

  it("offers policy choices without promising reserve recovery during a crisis", () => {
    const state: GameState = {
      ...initial,
      runState: "crisisStopped",
      economy: {
        ...initial.economy,
        stocks: { ...initial.economy.stocks, foreignReserves: stockLevel(0) },
      },
    };
    render(
      <PolicyForm
        state={state}
        onPreview={vi.fn()}
        busy={false}
        draftState={{
          ruleId: "fx-intervention",
          value: 0.01,
          quartersAhead: 0,
          policyId: "private-crisis-draft",
          expertIds: ["macro"],
        }}
      />,
    );
    const statuses = screen
      .getAllByRole("status")
      .map((element) => element.textContent);
    expect(statuses.join("")).toContain("外貨準備が足りません");
    expect(statuses.join("")).not.toMatch(/月を進め|回復を待つ/);
    expect(statuses).toMatchSnapshot();
    expect(screen.getByRole("button", { name: "見通しを確認" })).toBeDisabled();
  });

  it("explains how to continue after all quarterly policy slots are used", () => {
    const state: GameState = {
      ...initial,
      policyAdministration: {
        reservations: [],
        receipts: [0, 1, 2].map((index) => ({
          commandId: `private-command-${index}`,
          fingerprint: `private-fingerprint-${index}`,
          quarter: 0,
          monthIndex: 0,
          kind: "commit",
          policyId: `private-policy-${index}`,
        })),
      },
    };
    render(<PolicyForm state={state} onPreview={vi.fn()} busy={false} />);
    expect(screen.getByRole("status").textContent).toMatchSnapshot();
    expect(
      screen.getByText(/今四半期の3枠を使い切りました/).textContent,
    ).toMatchSnapshot();
    expect(screen.getByRole("button", { name: "見通しを確認" })).toBeDisabled();
  });

  it("shows progress and prevents duplicate preview requests", () => {
    const onPreview = vi.fn();
    render(<PolicyForm state={initial} onPreview={onPreview} busy />);
    const button = screen.getByRole("button", {
      name: "見通しを計算しています…",
    });
    expect(button.textContent).toMatchSnapshot();
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("keeps ordinary news and gives retry guidance after special reporting fails", async () => {
    news.mockRejectedValue(new Error("INTERNAL_AI_PROVIDER_FAILURE"));
    const { container } = render(<Report state={initial} />);
    const headline = container.querySelector(
      ".panel:last-of-type h4",
    )?.textContent;
    expect(headline).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "特別報道を読む" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatchSnapshot();
    expect(container).not.toHaveTextContent("INTERNAL_AI_PROVIDER_FAILURE");
    expect(
      screen.getByRole("heading", { name: headline! }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "特別報道を読む" }),
    ).toBeEnabled();
  });
});

describe("expert identity in policy meeting and preview", () => {
  it("shows each candidate's matching portrait, name, role and tone", () => {
    render(<PolicyForm state={initial} onPreview={vi.fn()} busy={false} />);
    const picker = screen.getByRole("group", {
      name: "解説を聞く専門家（1〜3人）",
    });
    const profiles = expertProfilesForContentVersion(
      initial.versions.contentVersion,
    );
    expect(within(picker).getAllByRole("checkbox")).toHaveLength(8);
    for (const profile of profiles) {
      const checkbox = within(picker).getByRole("checkbox", {
        name: new RegExp(profile.displayName!),
      });
      const card = checkbox.closest("label")!;
      const portrait = expertPortraitManifest.find(
        (item) => item.expertId === profile.id,
      )!;
      expect(
        within(card).getByRole("img", { name: portrait.altText }),
      ).toHaveAttribute("src", `${import.meta.env.BASE_URL}${portrait.src}`);
      expect(card).toHaveTextContent(profile.displayName!);
      expect(card).toHaveTextContent(`${profile.role} · ${profile.tone}`);
    }
  });

  it("preserves one-to-three selection and submits the selected expert IDs", () => {
    const onPreview = vi.fn();
    const onDraftChange = vi.fn();
    const before = structuredClone(initial);
    render(
      <PolicyForm
        state={initial}
        onPreview={onPreview}
        onDraftChange={onDraftChange}
        busy={false}
      />,
    );
    const profiles = expertProfilesForContentVersion(
      initial.versions.contentVersion,
    );
    const expertCheckbox = (id: string) =>
      screen.getByRole("checkbox", {
        name: new RegExp(
          profiles.find((profile) => profile.id === id)!.displayName!,
        ),
      });
    expect(expertCheckbox("macro")).toBeChecked();
    expect(expertCheckbox("macro")).toBeDisabled();
    fireEvent.click(expertCheckbox("centralBank"));
    fireEvent.click(expertCheckbox("fiscal"));
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(3);
    expect(expertCheckbox("labor")).toBeDisabled();
    fireEvent.click(expertCheckbox("macro"));
    expect(expertCheckbox("labor")).toBeEnabled();
    fireEvent.click(expertCheckbox("centralBank"));
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(1);
    expect(expertCheckbox("fiscal")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "見通しを確認" }));
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft" }),
      ["fiscal"],
    );
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ expertIds: ["fiscal"] }),
    );
    expect(initial).toEqual(before);
  });

  it("keeps candidate identity and selection available after every image fails", () => {
    const { container } = render(
      <PolicyForm state={initial} onPreview={vi.fn()} busy={false} />,
    );
    for (const image of container.querySelectorAll(".expert-portrait img")) {
      fireEvent.error(image);
    }
    expect(container.querySelector(".expert-portrait img")).toBeNull();
    expect(
      container.querySelectorAll(".expert-portrait-fallback"),
    ).toHaveLength(8);
    for (const profile of expertProfilesForContentVersion(
      initial.versions.contentVersion,
    )) {
      const checkbox = screen.getByRole("checkbox", {
        name: new RegExp(profile.displayName!),
      });
      expect(checkbox.closest("label")).toHaveTextContent(
        `${profile.role} · ${profile.tone}`,
      );
    }
    const fiscal = screen.getByRole("checkbox", { name: /大蔵 堅/ });
    fireEvent.click(fiscal);
    expect(fiscal).toBeChecked();
  });

  it("matches selected and dissenting advice portraits while retaining text on failure", () => {
    const before = structuredClone(output);
    const { container } = render(
      <Preview
        configSnapshot={initial.configSnapshot}
        output={output}
        counterfactuals={[]}
        expertIds={["fiscal", "labor"]}
        contentVersion={initial.versions.contentVersion}
        busy={false}
        onConfirm={vi.fn()}
      />,
    );
    const profiles = expertProfilesForContentVersion(
      initial.versions.contentVersion,
    );
    const cards = container.querySelectorAll(".expert-advice, .expert-dissent");
    expect(cards).toHaveLength(3);
    for (const [index, expertId] of [
      "fiscal",
      "labor",
      "centralBank",
    ].entries()) {
      const card = cards[index]!;
      const profile = profiles.find((item) => item.id === expertId)!;
      const portrait = expertPortraitManifest.find(
        (item) => item.expertId === expertId,
      )!;
      const image = within(card as HTMLElement).getByRole("img", {
        name: portrait.altText,
      });
      expect(image).toHaveAttribute(
        "src",
        `${import.meta.env.BASE_URL}${portrait.src}`,
      );
      // A header stays atomic when PageDeck paginates long advice.
      expect(image.closest("header")).toHaveTextContent(profile.displayName!);
      expect(image.closest("header")).toHaveTextContent(profile.role);
      expect(image.closest("header")).toHaveTextContent(profile.tone);
      fireEvent.error(image);
      expect(card.querySelector("img")).toBeNull();
      expect(card).toHaveTextContent(profile.displayName!);
      expect(card).toHaveTextContent(profile.role);
      expect(card).toHaveTextContent(profile.tone);
    }
    expect(output).toEqual(before);
  });
});
