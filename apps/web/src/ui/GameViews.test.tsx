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
import type { GameState } from "@macro-nation/domain";
import { scorePoint, stockLevel } from "@macro-nation/domain";
import {
  expertPortraitManifest,
  expertProfilesForContentVersion,
} from "@macro-nation/advisor-core";
import { PreviewClient } from "../infrastructure/preview-client";
import type { PreviewOutput } from "../application/policy-view";
import { createGame } from "../application/game-service";
import { learningEntriesForReport } from "../application/learning";
import { createReservedPolicy } from "../application/policy-view";
import { Home, PolicyForm, Preview, Report } from "./GameViews";
import { display } from "./game-format";

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
    expect(preview).toEqual(before);
  });

  it("guides the player when no preview exists", () => {
    render(
      <Preview
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
