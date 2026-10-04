import { describe, expect, it } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { createGame, type GameRepository } from "./game-service";
import {
  causeCategory,
  selectHomeIndicators,
  selectHomeMilestones,
  selectHomeRecommendations,
} from "./home-view";

describe("home view selector", () => {
  async function state(
    seed: string,
    duration: "short" | "long" = "short",
    difficulty: GameState["difficulty"] = "intro",
  ) {
    let saved: GameState | null = null;
    const repository: GameRepository = {
      async load() {
        return saved;
      },
      async create(next) {
        saved = next;
      },
      async save(_expected, next) {
        saved = next;
      },
    };
    return createGame(repository, seed, 1, "learning", duration, difficulty);
  }

  it("uses the selected duration for the scenario-end milestone", async () => {
    const game = await state("home-milestone", "long");
    expect(selectHomeMilestones(game)).toContainEqual({
      month: 239,
      text: "予定の運営期間が終わります",
    });
  });

  it("provides at most three non-binding suggestions only in intro difficulty", async () => {
    const intro = await state("home-intro");
    expect(selectHomeRecommendations(intro)).toEqual([
      "政策会議で、最初の政策案の見通しを確認してみましょう。",
      "レポートで、今月の変化の理由を見てみましょう。",
    ]);
    expect(
      selectHomeRecommendations({ ...intro, difficulty: "standard" }),
    ).toEqual([]);
  });

  it("exposes five neutral indicators before a monthly comparison exists", async () => {
    const game = await state("home-indicators");
    expect(selectHomeIndicators(game)).toHaveLength(5);
    expect(
      selectHomeIndicators(game).every((item) => item.direction === "steady"),
    ).toBe(true);
  });

  it("labels causal source categories", () => {
    expect(causeCategory("policy")).toBe("政策");
    expect(causeCategory("combo")).toBe("政策の組み合わせ");
    expect(causeCategory("external")).toBe("外部環境");
    expect(causeCategory("event")).toBe("イベント");
    expect(causeCategory("random")).toBe("偶発的な変動");
    expect(causeCategory("baseline")).toBe("前月から続く動き");
  });

  it("labels policy milestones without changing their saved IDs or timing", async () => {
    const initial = await state("home-policy-names");
    const policy = {
      policyId: "opaque-policy-instance",
      type: "publicWorks",
      decidedMonth: 0,
      activationMonth: 2,
      endMonth: 5,
      status: "active",
      slotQuarter: 0,
      costs: {
        politicalCapital: 0,
        implementationCapacity: 0,
        foreignReserves: 0,
        immediateBudget: 0,
      },
      sourceCommandId: "opaque-command",
    } as const;
    const game: GameState = {
      ...initial,
      policies: {
        ...initial.policies,
        active: [policy],
        reserved: [
          { ...policy, policyId: "second-policy-instance", status: "reserved" },
        ],
      },
    };
    const before = structuredClone(game);
    expect(selectHomeMilestones(game).slice(0, 2)).toEqual([
      { month: 2, text: "公共事業の政策が始まります" },
      { month: 6, text: "公共事業の政策が終わります" },
    ]);
    expect(game).toEqual(before);
  });
});
