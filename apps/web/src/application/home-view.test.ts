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
      text: "シナリオ終了",
    });
  });

  it("provides at most three non-binding suggestions only in intro difficulty", async () => {
    const intro = await state("home-intro");
    expect(selectHomeRecommendations(intro)).toEqual([
      "政策会議で最初の政策案を試算する",
      "レポートで今月の最大変化要因を確認する",
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
    expect(causeCategory("external")).toBe("外部要因");
    expect(causeCategory("random")).toBe("ランダム要因");
    expect(causeCategory("baseline")).toBe("慣性");
  });
});
