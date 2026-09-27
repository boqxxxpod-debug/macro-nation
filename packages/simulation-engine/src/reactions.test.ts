import { beforeAll, describe, expect, it } from "vitest";
import type {
  CausalContribution,
  GameState,
  VersionTuple,
} from "@macro-nation/domain";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
} from "@macro-nation/model-config";
import { createSCN01InitialState } from "./headless";
import { ENGINE_VERSION } from "./version";
import {
  attachReactionReferences,
  evaluateReactions,
  selectRepresentativeReaction,
} from "./reactions";

let state: GameState;

beforeAll(async () => {
  const pack = await loadSCN01ConfigPack();
  const configSnapshot = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  const versions: VersionTuple = {
    saveSchemaVersion: "2",
    engineVersion: ENGINE_VERSION,
    configSchemaVersion: pack.manifest.configSchemaVersion,
    modelVersion: pack.manifest.modelVersion,
    calibrationVersion: pack.manifest.calibrationVersion,
    contentVersion: pack.manifest.contentVersion,
    rngVersion: pack.manifest.rngVersion,
    configVersion: pack.manifest.configVersion,
  };
  state = createSCN01InitialState({
    configSnapshot,
    versions,
    seed: "reaction-test",
  });
});

function contribution(
  indicatorId: CausalContribution["indicatorId"],
  delta: number,
  sourceType: "policy" | "external" = "external",
): CausalContribution {
  return {
    indicatorId,
    beforeValue: 100,
    afterValue: 100 + delta,
    totalDelta: delta,
    diagnostics: [],
    contributions: [
      {
        sourceType,
        sourceId: sourceType === "policy" ? "policy-a" : "world-cycle",
        labelKey: `cause.${indicatorId}`,
        confidence: "high",
        delta,
      },
    ],
  };
}

describe("reaction model", () => {
  it("uses configured direction boundaries, strength tiers and audience lags", () => {
    const reactions = evaluateReactions(state, [
      contribution("inflation", 0.004),
    ]);

    expect(
      reactions.map(({ audience, lagMonths }) => ({ audience, lagMonths })),
    ).toEqual([
      { audience: "citizens", lagMonths: 1 },
      { audience: "business", lagMonths: 2 },
      { audience: "market", lagMonths: 0 },
    ]);
    expect(reactions.map((reaction) => reaction.direction)).toEqual([
      -1, -1, -1,
    ]);
    expect(reactions.every((reaction) => reaction.strength >= 1)).toBe(true);
    expect(reactions.every((reaction) => reaction.causeRefs.length > 0)).toBe(
      true,
    );
  });

  it("supports mixed signals, clamps strength and sorts deterministically", () => {
    const causal = [
      contribution("investment", 2),
      contribution("inflation", 0.03),
    ];
    const first = evaluateReactions(state, causal);
    const second = evaluateReactions(state, [...causal].reverse());

    expect(first.find((item) => item.audience === "business")?.direction).toBe(
      1,
    );
    expect(first.find((item) => item.audience === "citizens")?.direction).toBe(
      -1,
    );
    expect(first.every((item) => item.strength <= 3)).toBe(true);
    expect(first).toEqual(second);
    expect(selectRepresentativeReaction(first)).toEqual(
      [...first].sort(
        (left, right) =>
          right.strength - left.strength ||
          left.audience.localeCompare(right.audience),
      )[0],
    );
  });

  it("charges a policy decision cost once even when it has several causal terms", () => {
    const costlyState: GameState = {
      ...state,
      policies: {
        ...state.policies,
        active: [
          {
            policyId: "policy-a",
            type: "publicWorks",
            decidedMonth: 0,
            activationMonth: 0,
            status: "active",
            slotQuarter: 0,
            costs: {
              politicalCapital: 100,
              implementationCapacity: 0,
              foreignReserves: 0,
              immediateBudget: 0,
            },
            sourceCommandId: "command-a",
          },
        ],
      },
    };
    const oneTerm = evaluateReactions(costlyState, [
      contribution("industryAggregateResidual", 1, "policy"),
    ]);
    const repeatedTerm = evaluateReactions(costlyState, [
      contribution("industryAggregateResidual", 1, "policy"),
      contribution("industryAggregateResidual", 1, "policy"),
    ]);

    expect(repeatedTerm).toEqual(oneTerm);
  });

  it("retains no-policy economic causes without changing economic state", () => {
    const before = JSON.stringify(state.economy);
    const reactions = evaluateReactions(state, [contribution("realGdp", 0.2)]);
    const next = attachReactionReferences(state, reactions);

    expect(JSON.stringify(next.economy)).toBe(before);
    expect(next.history).toBe(state.history);
    expect(reactions).toHaveLength(3);
  });
});
