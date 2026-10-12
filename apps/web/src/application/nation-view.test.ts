import { describe, expect, it } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { createGame, type GameRepository } from "./game-service";
import rules from "./nation-view-rules.json";
import {
  selectNationView,
  stableStage,
  stableStructureStage,
} from "./nation-view";

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
  it("requires sustained monthly evidence before changing buildings and slows demolition", () => {
    const config = rules.structures.transition;
    expect(stableStructureStage([1, 1, 1, 1.4], config)).toBe(1);
    expect(stableStructureStage([1.4, 1.4, 1.4, 1.4], config)).toBe(3);
    expect(stableStructureStage([1.4, 1.4, 1.4, 1.4, 0.6], config)).toBe(3);
    expect(stableStructureStage(Array(7).fill(0.6), config)).toBe(1);
    expect(stableStructureStage(Array(8).fill(0.6), config)).toBe(0);
  });

  it("keeps fixed plots and changes count and kinds for city, industry and harbor", async () => {
    const initial = await fixture();
    const report = initial.history.reports![0]!;
    const withReports = (ratio: number, months: number): GameState => ({
      ...initial,
      monthIndex: months - 1,
      history: {
        ...initial.history,
        reports: Array.from({ length: months }, (_, monthIndex) => ({
          ...report,
          monthIndex,
          values: {
            ...report.values,
            realGdp: report.values.realGdp! * ratio,
            manufacturing: report.values.manufacturing! * ratio,
            exports: report.values.exports! * ratio,
          },
        })),
      },
    });
    expect(
      selectNationView(withReports(0.6, 7)).regions.city.structureStage,
    ).toBe(1);
    const low = selectNationView(withReports(0.6, 8));
    expect(low.regions.city.structureReason).toContain("施設の規模を縮小");
    const stable = selectNationView(withReports(1, 8));
    const active = selectNationView(withReports(1.1, 4));
    const veryActiveState = withReports(1.4, 4);
    const before = structuredClone(veryActiveState);
    const veryActive = selectNationView(veryActiveState);
    expect(veryActive.regions.city.structureReason).toContain(
      "施設が増えました",
    );
    for (const id of ["city", "industry", "harbor"] as const) {
      expect(
        [low, stable, active, veryActive].map(
          (model) => model.regions[id].structures.length,
        ),
      ).toEqual([1, 2, 3, 4]);
      const kinds = [low, stable, active, veryActive].map((model) =>
        model.regions[id].structures.map((item) => item.kind),
      );
      expect(new Set(kinds[3]).size).toBe(4);
      for (let index = 1; index < kinds.length; index += 1)
        expect(kinds[index]!.slice(0, index)).toEqual(kinds[index - 1]);
      const first = low.regions[id].structures[0]!;
      expect(
        [stable, active, veryActive].map((model) => {
          const { x, y, width, height } = model.regions[id].structures[0]!;
          return [x, y, width, height];
        }),
      ).toEqual(Array(3).fill([first.x, first.y, first.width, first.height]));
    }
    expect(
      veryActive.regions.energy.structures.map((item) => item.kind),
    ).toEqual(expect.arrayContaining(["pylon", "substation"]));
    expect(
      veryActive.regions.energy.structures.every(
        (item) => item.kind !== "turbine" && item.kind !== "solar",
      ),
    ).toBe(true);
    expect(veryActiveState).toEqual(before);
    expect(selectNationView(structuredClone(veryActiveState))).toEqual(
      veryActive,
    );
  });

  it("uses a short shock for activity only and leaves buildings at the saved stage", async () => {
    const initial = await fixture();
    const baseline = selectNationView(initial);
    const shock: GameState = {
      ...initial,
      economy: {
        ...initial.economy,
        industries: {
          ...initial.economy.industries,
          manufacturing: {
            ...initial.economy.industries.manufacturing,
            productionIndex:
              140 as typeof initial.economy.industries.manufacturing.productionIndex,
          },
        },
      },
    };
    const changed = selectNationView(shock);
    expect(changed.regions.industry.stage).toBe(3);
    expect(changed.regions.industry.structures.map((item) => item.id)).toEqual(
      baseline.regions.industry.structures.map((item) => item.id),
    );
    expect(changed.regions.industry.structures[0]?.status).toBe("peak");
    expect(changed.regions.industry.structureReason).toContain(
      "施設の規模は過去の月次結果を維持",
    );
  });

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
    expect(view.eventMarkers).toContain("危機への対応を待っています");
    expect(state).toEqual(before);
    expect(selectNationView(structuredClone(state))).toEqual(view);
  });

  it("shows saved event names and a crisis ending without exposing IDs or changing the state", async () => {
    const initial = await fixture();
    const state: GameState = {
      ...initial,
      runState: "failed",
      events: {
        ...initial.events,
        activeEventIds: ["saved-event-id", "unknown-event-id"],
      },
      configSnapshot: {
        ...initial.configSnapshot,
        normalizedConfig: {
          ...initial.configSnapshot.normalizedConfig,
          content: {
            events: [
              { eventId: "saved-event-id", title: "保存時のイベント名" },
            ],
          },
        },
      },
    };
    const before = structuredClone(state);
    expect(selectNationView(state).eventMarkers).toEqual([
      "保存時のイベント名",
      "イベントが起きています",
      "危機により運営が終了しました",
    ]);
    expect(selectNationView(state).overlays).toEqual([
      "危機により運営が終了しました",
    ]);
    expect(state).toEqual(before);
  });
});
