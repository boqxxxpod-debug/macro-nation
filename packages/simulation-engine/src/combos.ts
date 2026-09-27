import type {
  GameState,
  PolicyCosts,
  PolicyDecision,
  ScheduledEffect,
} from "@macro-nation/domain";

export interface ComboDefinition {
  readonly comboId: string;
  readonly requiredPolicies: readonly { readonly policyId: string }[];
  readonly forbiddenPolicies?: readonly { readonly policyId: string }[];
  readonly requiresCombos?: readonly string[];
  readonly minOverlapMonths: number;
  readonly kind: "synergy" | "cancellation";
  readonly effects: readonly {
    readonly targetPath: string;
    readonly kernelId: string;
    readonly operation: "addDelta" | "addRate" | "multiply";
    readonly baseStrength: number;
    readonly role: "primary" | "sideEffect";
    readonly labelKey: string;
  }[];
  readonly additionalCosts?: PolicyCosts;
  readonly explanationKey: string;
  readonly priority: number;
}

export type ComboMissReason =
  | "missing-required-policy"
  | "forbidden-policy"
  | "insufficient-overlap"
  | "insufficient-additional-cost"
  | "missing-required-combo"
  | "already-fired-this-month";

export interface ComboEvaluation {
  readonly comboId: string;
  readonly kind: ComboDefinition["kind"];
  readonly activated: boolean;
  readonly reason?: ComboMissReason;
  readonly explanationKey: string;
  readonly requiredPolicyIds: readonly string[];
  readonly forbiddenPolicyIds: readonly string[];
  readonly overlapMonths: number;
  readonly additionalCosts: PolicyCosts;
  readonly effects: readonly ScheduledEffect[];
}

export interface ComboEvaluationResult {
  readonly results: readonly ComboEvaluation[];
  readonly effects: readonly ScheduledEffect[];
  readonly costs: PolicyCosts;
}

const ZERO_COSTS: PolicyCosts = {
  politicalCapital: 0,
  implementationCapacity: 0,
  foreignReserves: 0,
  immediateBudget: 0,
};

export function comboDefinitions(state: GameState): readonly ComboDefinition[] {
  const content = state.configSnapshot.normalizedConfig.content as {
    combos?: readonly ComboDefinition[];
  };
  return content.combos ?? [];
}

function addCosts(left: PolicyCosts, right: PolicyCosts): PolicyCosts {
  return {
    politicalCapital: left.politicalCapital + right.politicalCapital,
    implementationCapacity:
      left.implementationCapacity + right.implementationCapacity,
    foreignReserves: left.foreignReserves + right.foreignReserves,
    immediateBudget: left.immediateBudget + right.immediateBudget,
  };
}

function canPay(available: PolicyCosts, spent: PolicyCosts, cost: PolicyCosts) {
  return (Object.keys(cost) as (keyof PolicyCosts)[]).every(
    (key) => available[key] - spent[key] >= cost[key],
  );
}

function overlap(policies: readonly PolicyDecision[]): number {
  const start = Math.max(...policies.map((policy) => policy.activationMonth));
  const end = Math.min(
    ...policies.map((policy) => policy.endMonth ?? Number.MAX_SAFE_INTEGER),
  );
  return Math.max(0, end - start + 1);
}

function effectsFor(
  definition: ComboDefinition,
  state: GameState,
  month: number,
): readonly ScheduledEffect[] {
  const kernels = state.configSnapshot.normalizedConfig.lagKernels as readonly {
    kernelId: string;
    start: number;
    end: number;
    weights: readonly number[];
  }[];
  return definition.effects.map((spec, index) => {
    const kernel = kernels.find((item) => item.kernelId === spec.kernelId);
    if (!kernel) throw new Error(`Unknown combo kernel ${spec.kernelId}`);
    return {
      effectId: `combo:${definition.comboId}:${month}:${index}`,
      sourceType: "combo",
      sourceId: definition.comboId,
      comboId: definition.comboId,
      targetPath: spec.targetPath,
      operation: spec.operation,
      startMonth: month + kernel.start,
      endMonth: month + kernel.end,
      curveId: kernel.kernelId,
      weights: [...kernel.weights],
      totalWeight: 1,
      baseStrength: spec.baseStrength,
      modifierIds: [],
      uncertainty: { low: 0.8, high: 1.2 },
      role: spec.role,
      labelKey: spec.labelKey,
    };
  });
}

/** Pure evaluator shared by forecast and live activation. Each definition can fire once per call. */
export function evaluatePolicyCombos(
  state: GameState,
  policies: readonly PolicyDecision[],
  month: number,
  available: PolicyCosts = {
    politicalCapital: state.resources.politicalCapital,
    implementationCapacity: state.resources.implementationCapacity,
    foreignReserves: state.economy.stocks.foreignReserves,
    immediateBudget: state.resources.discretionaryBudget,
  },
): ComboEvaluationResult {
  const ruleTypes = new Map(
    (
      state.configSnapshot.normalizedConfig.policyRules as readonly {
        policyId: string;
        policyType: string;
      }[]
    ).map((rule) => [rule.policyId, rule.policyType]),
  );
  const activated = new Set<string>();
  let spent = ZERO_COSTS;
  const results: ComboEvaluation[] = [];
  const allEffects: ScheduledEffect[] = [];
  for (const definition of [...comboDefinitions(state)].sort(
    (a, b) => b.priority - a.priority || a.comboId.localeCompare(b.comboId),
  )) {
    const required = definition.requiredPolicies.map((predicate) =>
      policies.find(
        (policy) => policy.type === ruleTypes.get(predicate.policyId),
      ),
    );
    const relevant = required.filter(
      (policy): policy is PolicyDecision => !!policy,
    );
    const overlapMonths =
      relevant.length === required.length ? overlap(relevant) : 0;
    const forbidden = (definition.forbiddenPolicies ?? []).some((predicate) =>
      policies.some(
        (policy) => policy.type === ruleTypes.get(predicate.policyId),
      ),
    );
    const cost = definition.additionalCosts ?? ZERO_COSTS;
    const alreadyFired = state.effects.some(
      (effect) =>
        effect.comboId === definition.comboId &&
        effect.effectId.includes(`:${month}:`),
    );
    const reason: ComboMissReason | undefined =
      relevant.length !== required.length
        ? "missing-required-policy"
        : forbidden
          ? "forbidden-policy"
          : overlapMonths < definition.minOverlapMonths
            ? "insufficient-overlap"
            : (definition.requiresCombos ?? []).some((id) => !activated.has(id))
              ? "missing-required-combo"
              : alreadyFired
                ? "already-fired-this-month"
                : !canPay(available, spent, cost)
                  ? "insufficient-additional-cost"
                  : undefined;
    const effects = reason ? [] : effectsFor(definition, state, month);
    if (!reason) {
      activated.add(definition.comboId);
      spent = addCosts(spent, cost);
      allEffects.push(...effects);
    }
    results.push({
      comboId: definition.comboId,
      kind: definition.kind,
      activated: !reason,
      ...(reason ? { reason } : {}),
      explanationKey: definition.explanationKey,
      requiredPolicyIds: definition.requiredPolicies.map(
        (item) => item.policyId,
      ),
      forbiddenPolicyIds: (definition.forbiddenPolicies ?? []).map(
        (item) => item.policyId,
      ),
      overlapMonths,
      additionalCosts: cost,
      effects,
    });
  }
  return { results, effects: allEffects, costs: spent };
}
