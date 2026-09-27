import { describe, expect, it } from "vitest";
import type { GameState, ReactionSnapshot } from "@macro-nation/domain";
import { createGame, type GameRepository } from "./game-service";
import { selectNationVoices } from "./nation-voice";

async function fixture(): Promise<GameState> {
  const repository: GameRepository = {
    async load() {
      return null;
    },
    async save() {},
    async create() {},
  };
  return createGame(repository, "nation-voice-test");
}

function reaction(
  audience: ReactionSnapshot["audience"],
  month: number,
  strength: ReactionSnapshot["strength"],
  topic: string,
): ReactionSnapshot {
  return {
    reactionId: `reaction:${month}:${audience}:${topic}`,
    audience,
    month,
    strength,
    direction: audience === "market" ? -1 : 1,
    lagMonths: audience === "market" ? 0 : 1,
    representativeTopicKey: topic,
    causeRefs: [
      {
        sourceType: "policy",
        sourceId: `policy-${topic}`,
        labelKey: topic,
        confidence: "high",
      },
    ],
  };
}

describe("Nation Voice selector", () => {
  it("selects each audience deterministically by strength, recency and topic", async () => {
    const initial = await fixture();
    const reactions = [
      reaction("citizens", 1, 2, "tax"),
      reaction("citizens", 2, 3, "jobs"),
      reaction("citizens", 3, 3, "prices"),
      reaction("business", 3, 2, "investment"),
      reaction("market", 3, 2, "currency"),
    ];
    const state: GameState = {
      ...initial,
      monthIndex: 2,
      history: {
        ...initial.history,
        reports: [
          {
            monthIndex: 3,
            values: {},
            topCauses: [],
            reactions,
          },
        ],
      },
    };

    const voices = selectNationVoices(state);
    expect(voices.map((voice) => voice.audience)).toEqual([
      "citizens",
      "business",
      "market",
    ]);
    expect(voices[0]?.topicKey).toBe("prices");
    expect(voices[0]?.causeRef).toEqual(reactions[2]?.causeRefs[0]);
    expect(selectNationVoices(structuredClone(state))).toEqual(voices);
  });

  it("does not invent a voice for missing or stale reaction data", async () => {
    const initial = await fixture();
    const state: GameState = {
      ...initial,
      monthIndex: 20,
      history: {
        ...initial.history,
        reports: [
          {
            monthIndex: 1,
            values: {},
            topCauses: [],
            reactions: [reaction("citizens", 1, 3, "old")],
          },
        ],
      },
    };
    expect(selectNationVoices(state)).toEqual([]);
  });
});
