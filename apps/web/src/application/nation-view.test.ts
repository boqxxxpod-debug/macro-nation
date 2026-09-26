import { describe, expect, it } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { createGame, type GameRepository } from "./game-service";
import { selectNationView, stableStage } from "./nation-view";

async function fixture(): Promise<GameState> {
  const repository: GameRepository = {
    async load() {
      return null;
    },
    async save() {},
    async create() {},
  };
  return createGame(repository, "nation-view-mapping");
}

describe("read-only NationViewSelector", () => {
  it("uses separate enter and exit boundaries, including when rebuilt after reload", () => {
    const boundaries = { thresholds: [0.82, 1, 1.18], margin: 0.025 };
    expect(stableStage([1, 1.024], boundaries)).toBe(1);
    expect(stableStage([1, 1.026, 1.001, 0.976], boundaries)).toBe(2);
    expect(stableStage([1, 1.026, 0.974], boundaries)).toBe(1);
    expect(stableStage([1, 0.79], boundaries)).toBe(0);
    expect(stableStage([1, 1.21], boundaries)).toBe(3);
  });

  it("maps all seven regions from current economy and one causal report without changing the run", async () => {
    const initial = await fixture();
    const state: GameState = {
      ...initial,
      runState: "crisisStopped",
      economy: {
        ...initial.economy,
        indices: {
          ...initial.economy.indices,
          realGdp: 125 as typeof initial.economy.indices.realGdp,
        },
      },
      history: {
        ...initial.history,
        reports: [
          ...initial.history.reports!,
          {
            monthIndex: 1,
            values: { realGdp: 125 },
            topCauses: [
              {
                indicatorId: "realGdp",
                sourceType: "external",
                sourceId: "world-demand",
                labelKey: "growth",
                delta: 1,
              },
            ],
          },
        ],
      },
    };
    const before = structuredClone(state);
    const view = selectNationView(state);
    expect(view.regions.city.value).toBe(125);
    expect(view.regions.city.stage).toBe(2);
    expect(view.regions.city.topCause?.sourceId).toBe("world-demand");
    expect(view.regions.city.previous).toBe(initial.economy.indices.realGdp);
    expect(Object.keys(view.regions)).toHaveLength(7);
    expect(view.eventMarkers).toContain("危機停止");
    expect(state).toEqual(before);
    expect(selectNationView(structuredClone(state))).toEqual(view);
  });
});
