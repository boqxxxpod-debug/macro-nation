import { describe, expect, it } from "vitest";
import type { GameState, ReviewSnapshot } from "@macro-nation/domain";
import { createGame, type GameRepository } from "./game-service";
import { endingHistorySummary, nationalHistory } from "./history";

async function initial(seed = "history-replay"): Promise<GameState> {
  let saved: GameState | null = null;
  const repository: GameRepository = {
    async load() {
      return saved;
    },
    async create(state) {
      saved = state;
    },
    async save(_expected, state) {
      saved = state;
    },
  };
  return createGame(repository, seed, 1, "standard", "ultraLong");
}

function review(monthIndex: number): ReviewSnapshot {
  return {
    monthIndex,
    axes: {
      living: 50,
      growth: 50 + monthIndex / 60,
      stability: 60,
      sustainability: 55,
      trust: 52,
    },
    policyIds: [],
    crisisMonths: 0,
    causeRefs: [`cause-${monthIndex}`],
  };
}

describe("national history", () => {
  it("merges same-month references and orders all six 30-year reviews once", async () => {
    const state = await initial();
    const reviews = [60, 120, 180, 240, 300, 360].map(review);
    const completed: GameState = {
      ...state,
      monthIndex: 360,
      runState: "completed",
      events: {
        ...state.events,
        occurrences: [
          {
            eventId: "evt-120",
            occurredMonth: 120,
            preparedness: 0.5,
            baselineDamage: -1,
            preparednessMitigation: 0.2,
            choiceMitigation: 0.1,
            choiceId: "balanced",
            targetPath: "economy.indices.realGdp",
          },
        ],
      },
      history: {
        ...state.history,
        reviews,
        appliedMilestones: [120, 240, 360].map(
          (month) => `${state.gameId}:structure:${month}`,
        ),
      },
    };
    const entries = nationalHistory(completed);
    expect(
      entries
        .filter((entry) => entry.categories.includes("review"))
        .map((entry) => entry.month),
    ).toEqual([60, 120, 180, 240, 300, 360]);
    expect(entries.filter((entry) => entry.month === 120)).toHaveLength(1);
    expect(entries.find((entry) => entry.month === 120)?.categories).toEqual([
      "event",
      "review",
      "structure",
    ]);
    expect(entries.at(-1)?.categories).toContain("ending");
  });

  it("is deterministic and retains a failed ending cause", async () => {
    const state = await initial("failure-history");
    const failed: GameState = {
      ...state,
      monthIndex: 17,
      runState: "failed",
      history: {
        ...state.history,
        reports: [
          ...(state.history.reports ?? []),
          {
            monthIndex: 17,
            values: {},
            topCauses: [
              {
                indicatorId: "policyTrust",
                sourceType: "policy",
                sourceId: "decision-before-failure",
                labelKey: "test",
                delta: -5,
              },
            ],
          },
        ],
      },
    };
    expect(nationalHistory(structuredClone(failed))).toEqual(
      nationalHistory(failed),
    );
    expect(nationalHistory(failed).at(-1)?.categories).toEqual([
      "crisis",
      "ending",
    ]);
    expect(endingHistorySummary(failed).failureCauseRefs).toContain(
      "decision-before-failure",
    );
  });
});
