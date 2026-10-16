import type { GameState, PolicyCosts } from "@macro-nation/domain";

export const POLICY_RESOURCE_KEYS = [
  "politicalCapital",
  "implementationCapacity",
  "foreignReserves",
  "immediateBudget",
] as const satisfies readonly (keyof PolicyCosts)[];

export interface PolicyResourceComparison {
  readonly key: keyof PolicyCosts;
  readonly current: number;
  readonly reserved: number;
  readonly available: number;
  readonly cost: number;
  readonly remaining: number;
  readonly shortage: number;
}

/** Read the same resources and legacy reservation fallback as command validation. */
export function policyResourceComparison(
  state: GameState,
  costs: PolicyCosts,
): readonly PolicyResourceComparison[] {
  const current: PolicyCosts = {
    politicalCapital: state.resources.politicalCapital,
    implementationCapacity: state.resources.implementationCapacity,
    foreignReserves: state.economy.stocks.foreignReserves,
    immediateBudget: state.resources.discretionaryBudget,
  };
  const reservations =
    state.policyAdministration?.reservations ??
    state.policies.reserved.map((policy) => ({ costs: policy.costs }));

  return POLICY_RESOURCE_KEYS.map((key) => {
    const reserved = reservations.reduce(
      (sum, reservation) => sum + reservation.costs[key],
      0,
    );
    const available = current[key] - reserved;
    // Keep negative amounts visible so a shortage cannot look affordable.
    const remaining = available - costs[key];
    return {
      key,
      current: current[key],
      reserved,
      available,
      cost: costs[key],
      remaining,
      shortage: Math.max(0, -remaining),
    };
  });
}
