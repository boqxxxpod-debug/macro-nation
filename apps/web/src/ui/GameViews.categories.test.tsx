import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import type { NewsStory } from "@macro-nation/advisor-core";
import { createGame } from "../application/game-service";
import { Report } from "./GameViews";

const { news } = vi.hoisted(() => ({ news: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({
  createBrowserAIService: () => ({ news }),
}));

let initial: GameState;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "issue-108-categories",
  );
});
afterEach(() => {
  cleanup();
  news.mockReset();
});

function choices() {
  return within(screen.getByRole("combobox", { name: "経済レポートのカテゴリ" }))
    .getAllByRole("option")
    .map((option) => (option as HTMLOptionElement).value);
}

function selectCategory(value: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "経済レポートのカテゴリ" }), {
    target: { value },
  });
}

describe("report category integration", () => {
  it.each(["casual", "standard", "learning"] as const)(
    "%s hides empty optional categories while retaining useful placeholders",
    (learningMode) => {
      const state: GameState = {
        ...initial,
        learningMode,
        history: { ...initial.history, reports: [], learningEntries: [] },
      };
      const before = structuredClone(state);
      render(<Report state={state} />);
      expect(choices()).toEqual([
        "trend", "causes", "history",
        ...(learningMode === "learning" ? ["learning"] : []),
        "news",
      ]);
      expect(screen.getByText("まだ節目の記録はありません。政策や出来事があると、ここに残ります。")).toBeInTheDocument();
      expect(screen.getByText("月を進めると、指標が変わった理由を確認できます。")).toBeInTheDocument();
      expect(state).toEqual(before);
    },
  );

  it("groups school comparisons, forecast records and notebooks into learning and includes available voices", () => {
    const state: GameState = {
      ...initial,
      learningMode: "learning",
      history: {
        ...initial.history,
        reports: [{
          ...initial.history.reports![0]!,
          reactions: [{
            reactionId: "category-voice-fixture",
            month: initial.monthIndex,
            audience: "citizens",
            direction: 1,
            strength: 2,
            lagMonths: 1,
            representativeTopicKey: "jobs",
            causeRefs: [{
              sourceType: "external",
              sourceId: "external-demand",
              labelKey: "external.demand",
              confidence: "high",
            }],
          }],
        }],
      },
    };
    const before = structuredClone(state);
    render(<Report state={state} />);
    expect(choices()).toEqual(["trend", "causes", "voices", "history", "learning", "news"]);
    for (const name of ["思想比較", "専門家の予測記録", "経済学ノート"]) {
      for (const heading of screen.getAllByRole("heading", { name, exact: true })) {
        expect(heading.closest("[data-page-item]")).toHaveAttribute("data-page-category", "learning");
      }
    }
    for (const category of choices()) selectCategory(category);
    expect(state).toEqual(before);
  });

  it.each(["success", "error"] as const)(
    "retains a pending news request and its %s after switching categories",
    async (outcome) => {
      let resolveNews!: (value: NewsStory) => void;
      let rejectNews!: (reason: Error) => void;
      news.mockReturnValueOnce(new Promise<NewsStory>((resolve, reject) => {
        resolveNews = resolve;
        rejectNews = reject;
      }));
      const before = structuredClone(initial);
      render(<Report state={initial} />);
      selectCategory("news");
      fireEvent.click(screen.getByRole("button", { name: "特別報道を読む" }));
      selectCategory("trend");
      selectCategory("news");
      expect(screen.getByRole("button", { name: "特別報道を読み込んでいます…" })).toBeDisabled();
      expect(news).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (outcome === "success") resolveNews({
          headline: "カテゴリ移動後も受け取った報道",
          explanation: "同じ計算結果を説明します。",
          perspectives: [],
        });
        else rejectNews(new Error("fixture news unavailable"));
      });
      await waitFor(() => expect(screen.getByRole("button", { name: "特別報道を読む" })).toBeEnabled());
      selectCategory("history");
      selectCategory("news");
      if (outcome === "success") expect(screen.getByRole("heading", { name: "カテゴリ移動後も受け取った報道" })).toBeInTheDocument();
      else expect(screen.getByRole("alert")).toHaveTextContent("特別報道を読み込めませんでした。");
      expect(news).toHaveBeenCalledTimes(1);
      expect(initial).toEqual(before);
    },
  );
});
