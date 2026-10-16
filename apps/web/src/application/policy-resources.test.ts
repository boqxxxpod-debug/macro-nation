import { beforeAll, describe, expect, it } from "vitest";
import {
  scorePoint,
  stockLevel,
  type GameState,
  type PolicyCosts,
} from "@macro-nation/domain";
import {
  activateDuePolicies,
  applyPolicyCommand,
  createReservedPolicy,
  policyStateHash,
  previewPolicy,
  type PolicyDraft,
} from "@macro-nation/simulation-engine";
import { createGame } from "./game-service";
import {
  POLICY_RESOURCE_KEYS,
  policyResourceComparison,
} from "./policy-resources";

const ZERO_COSTS: PolicyCosts = {
  politicalCapital: 0,
  implementationCapacity: 0,
  foreignReserves: 0,
  immediateBudget: 0,
};

let initial: GameState;
beforeAll(async () => {
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "policy-resource-comparison",
  );
});

function commit(
  state: GameState,
  policyId: string,
  ruleId: string,
  value: number,
  quartersAhead = 0,
): GameState {
  const hash = policyStateHash(state);
  return applyPolicyCommand(state, {
    kind: "commit",
    commandId: `commit-${policyId}`,
    expectedStateHash: hash,
    draft: {
      status: "previewed",
      policyId,
      ruleId,
      value,
      quartersAhead,
      previewStateHash: hash,
    },
  }).state;
}

function values(
  state: GameState,
  costs: PolicyCosts,
  field: "current" | "reserved" | "available" | "remaining" | "shortage",
) {
  return Object.fromEntries(
    policyResourceComparison(state, costs).map((row) => [row.key, row[field]]),
  );
}

describe("policy resource comparison", () => {
  it("compares real SCN-01 public works at 1% with all four current resources", () => {
    const preview = previewPolicy({
      state: initial,
      draft: {
        status: "draft",
        policyId: "public-works-one-percent",
        ruleId: "public-works",
        value: 0.01,
        quartersAhead: 0,
      },
      horizonMonths: 12,
    });
    expect(preview.costs).toEqual({
      politicalCapital: 5,
      implementationCapacity: 10,
      foreignReserves: 0,
      immediateBudget: 10,
    });
    expect(policyResourceComparison(initial, preview.costs)).toEqual([
      {
        key: "politicalCapital",
        current: 60,
        reserved: 0,
        available: 60,
        cost: 5,
        remaining: 55,
        shortage: 0,
      },
      {
        key: "implementationCapacity",
        current: 65,
        reserved: 0,
        available: 65,
        cost: 10,
        remaining: 55,
        shortage: 0,
      },
      {
        key: "foreignReserves",
        current: 300,
        reserved: 0,
        available: 300,
        cost: 0,
        remaining: 300,
        shortage: 0,
      },
      {
        key: "immediateBudget",
        current: 50,
        reserved: 0,
        available: 50,
        cost: 10,
        remaining: 40,
        shortage: 0,
      },
    ]);
  });

  it("matches held resources at commitment and actual deductions at activation", () => {
    const works = commit(initial, "works", "public-works", 0.01);
    const withFutureFx = commit(works, "future-fx", "fx-intervention", 0.01, 1);
    expect(values(withFutureFx, ZERO_COSTS, "current")).toEqual({
      politicalCapital: 60,
      implementationCapacity: 65,
      foreignReserves: 300,
      immediateBudget: 50,
    });
    expect(values(withFutureFx, ZERO_COSTS, "reserved")).toEqual({
      politicalCapital: 7,
      implementationCapacity: 11,
      foreignReserves: 12,
      immediateBudget: 10,
    });

    const activated = activateDuePolicies(withFutureFx).state;
    expect(values(activated, ZERO_COSTS, "available")).toEqual(
      values(withFutureFx, ZERO_COSTS, "available"),
    );
    expect(values(activated, ZERO_COSTS, "current")).toEqual({
      politicalCapital: 55,
      implementationCapacity: 55,
      foreignReserves: 300,
      immediateBudget: 40,
    });
    expect(values(activated, ZERO_COSTS, "reserved")).toEqual({
      politicalCapital: 2,
      implementationCapacity: 1,
      foreignReserves: 12,
      immediateBudget: 0,
    });
  });

  it("uses reserved policy costs for legacy saves, matching command validation", () => {
    const legacy: GameState = {
      ...initial,
      resources: {
        ...initial.resources,
        reservedForeignReserves: stockLevel(299),
      },
      policies: {
        ...initial.policies,
        reserved: [
          createReservedPolicy(
            initial,
            "public-works",
            0.01,
            "legacy-works",
            1,
          ),
          createReservedPolicy(
            initial,
            "fx-intervention",
            0.01,
            "legacy-fx",
            1,
          ),
        ],
      },
    };
    expect(legacy.policyAdministration).toBeUndefined();
    const costs = createReservedPolicy(
      initial,
      "public-works",
      0.01,
      "new",
    ).costs;
    const comparison = policyResourceComparison(legacy, costs);
    const committed = commit(legacy, "new-works", "public-works", 0.01);
    expect(values(committed, ZERO_COSTS, "available")).toEqual(
      Object.fromEntries(comparison.map((row) => [row.key, row.remaining])),
    );
    expect(
      comparison.find((row) => row.key === "foreignReserves"),
    ).toMatchObject({
      current: 300,
      reserved: 12,
      available: 288,
    });
  });

  it("honors an existing empty administration instead of re-counting policy buckets", () => {
    const state: GameState = {
      ...initial,
      policies: {
        ...initial.policies,
        reserved: [createReservedPolicy(initial, "public-works", 0.01, "old")],
      },
      policyAdministration: { reservations: [], receipts: [] },
    };
    expect(values(state, ZERO_COSTS, "reserved")).toEqual(ZERO_COSTS);
    expect(
      values(
        commit(state, "new", "public-works", 0.01),
        ZERO_COSTS,
        "reserved",
      ),
    ).toEqual(createReservedPolicy(initial, "public-works", 0.01, "new").costs);
  });

  it("shows exact shortages without clamping remaining amounts or omitting zero costs", () => {
    const state: GameState = {
      ...initial,
      resources: {
        ...initial.resources,
        politicalCapital: scorePoint(4),
        implementationCapacity: scorePoint(9.5),
        discretionaryBudget: stockLevel(8),
      },
      economy: {
        ...initial.economy,
        stocks: { ...initial.economy.stocks, foreignReserves: stockLevel(1) },
      },
    };
    const costs = createReservedPolicy(
      initial,
      "public-works",
      0.01,
      "new",
    ).costs;
    expect(values(state, costs, "remaining")).toEqual({
      politicalCapital: -1,
      implementationCapacity: -0.5,
      foreignReserves: 1,
      immediateBudget: -2,
    });
    expect(values(state, costs, "shortage")).toEqual({
      politicalCapital: 1,
      implementationCapacity: 0.5,
      foreignReserves: 0,
      immediateBudget: 2,
    });
    expect(() => commit(state, "unaffordable", "public-works", 0.01)).toThrow(
      "Insufficient available politicalCapital",
    );
    const fxCosts = createReservedPolicy(
      initial,
      "fx-intervention",
      0.01,
      "fx",
    ).costs;
    expect(values(state, fxCosts, "shortage").foreignReserves).toBe(11);
  });

  it("keeps combo additions separate from base policy costs and remaining amounts", () => {
    const tax = commit(initial, "tax", "tax-package", -0.01);
    const draft: PolicyDraft = {
      status: "draft",
      policyId: "works-with-tax",
      ruleId: "public-works",
      value: 0.01,
      quartersAhead: 0,
    };
    const preview = previewPolicy({ state: tax, draft, horizonMonths: 12 });
    const combo = preview.comboResults.find(
      (item) => item.comboId === "growth-investment-package",
    )!;
    expect(combo.activated).toBe(true);
    expect(combo.additionalCosts).toEqual({
      politicalCapital: 2,
      implementationCapacity: 3,
      foreignReserves: 0,
      immediateBudget: 1,
    });
    expect(values(tax, preview.costs, "remaining")).toEqual({
      politicalCapital: 51,
      implementationCapacity: 50,
      foreignReserves: 300,
      immediateBudget: 40,
    });
    const committed = commit(tax, draft.policyId, draft.ruleId, draft.value);
    const activated = activateDuePolicies(committed).state;
    for (const row of policyResourceComparison(tax, preview.costs)) {
      expect(values(committed, ZERO_COSTS, "reserved")[row.key]).toBe(
        row.reserved + row.cost,
      );
      expect(values(activated, ZERO_COSTS, "current")[row.key]).toBe(
        row.remaining - combo.additionalCosts[row.key],
      );
    }
  });

  it("treats preview combos involving future reservations as conditional additions", () => {
    const tax = commit(initial, "future-tax", "tax-package", -0.01, 3);
    const preview = previewPolicy({
      state: tax,
      draft: {
        status: "draft",
        policyId: "current-works",
        ruleId: "public-works",
        value: 0.01,
        quartersAhead: 0,
      },
      horizonMonths: 12,
    });
    expect(
      preview.comboResults.find(
        (combo) => combo.comboId === "growth-investment-package",
      ),
    ).toMatchObject({
      activated: true,
      additionalCosts: { politicalCapital: 2 },
    });
    const activated = activateDuePolicies(
      commit(tax, "current-works", "public-works", 0.01),
    ).state;
    expect(
      activated.effects.some((effect) => effect.sourceType === "combo"),
    ).toBe(false);
    expect(values(activated, ZERO_COSTS, "available")).toEqual(
      values(tax, preview.costs, "remaining"),
    );
  });

  it("reads frozen state and costs without mutating either", () => {
    const state = commit(initial, "frozen", "public-works", 0.01);
    const costs = Object.freeze({ ...ZERO_COSTS, immediateBudget: 3 });
    const before = structuredClone(state);
    for (const reservation of state.policyAdministration!.reservations) {
      Object.freeze(reservation.costs);
      Object.freeze(reservation);
    }
    Object.freeze(state.policyAdministration!.reservations);
    Object.freeze(state.policyAdministration);
    Object.freeze(state.resources);
    Object.freeze(state.economy.stocks);
    Object.freeze(state);
    expect(
      policyResourceComparison(state, costs).map((row) => row.key),
    ).toEqual(POLICY_RESOURCE_KEYS);
    expect(state).toEqual(before);
    expect(costs).toEqual({ ...ZERO_COSTS, immediateBudget: 3 });
  });
});
