import {
  percentRate,
  scorePoint,
  stockLevel,
  type CausalContribution,
  type ConfigSnapshot,
  type GameState,
  type PolicyDecision,
  type PolicyType,
  type ScheduledEffect,
} from "@macro-nation/domain";
import { createContributionBuilder } from "./causal";
import {
  createPolicyHandlerRegistry,
  validatePolicyInputs,
  type PolicyHandler,
  type PolicyRuleContract,
} from "./policy-registry";

export interface PolicyEffectSpec {
  readonly targetPath: string;
  readonly kernelId: string;
  readonly inputScale: number;
  readonly scaleBy: "absolute" | "gdp";
  readonly operation: "addDelta" | "addRate";
  readonly role: "primary" | "sideEffect";
  readonly inputMode: "signed" | "absoluteChange";
  readonly modifierIds: readonly (
    | "slack"
    | "capacity"
    | "debt"
    | "reserves"
    | "repeat"
    | "openness"
    | "trust"
    | "retaliation"
  )[];
}
export interface RuntimePolicyRule extends PolicyRuleContract {
  readonly costs: PolicyDecision["costs"];
  readonly referenceValue?: number;
  readonly defaultDurationMonths?: number;
  readonly terminationPoliticalCapital?: number;
  readonly effectSpecs?: readonly PolicyEffectSpec[];
  readonly regimeModifiers: Readonly<Record<string, number>>;
  readonly modifierSettings?: Readonly<Record<string, number>>;
}
interface Kernel {
  readonly kernelId: string;
  readonly start: number;
  readonly peak: number;
  readonly end: number;
  readonly shape: string;
  readonly weights: readonly number[];
}
const POLICY_TYPES = [
  "interestRate",
  "taxPackage",
  "publicWorks",
  "tariff",
  "fxIntervention",
] as const;
const EFFECT_TARGETS = new Set([
  "economy.indices.outputGap",
  "economy.indices.potentialGdp",
  "economy.flows.consumption",
  "economy.flows.investment",
  "economy.flows.governmentConsumption",
  "economy.flows.publicInvestment",
  "economy.flows.taxRevenue",
  "economy.flows.primarySpending",
  "economy.flows.exports",
  "economy.flows.imports",
  "economy.rates.marketRate",
  "economy.rates.inflationAnnual",
  "economy.indices.importPrice",
  "economy.indices.cpi",
  "economy.indices.fx",
  "economy.flows.foreignReserveChange",
  "economy.sentiment.policyTrust",
  "economy.industries.manufacturing.productionIndex",
  "economy.industries.energyLogistics.productionIndex",
]);

function snapshotArray<T>(snapshot: ConfigSnapshot, id: string): readonly T[] {
  const data = snapshot.normalizedConfig[id];
  if (!Array.isArray(data)) throw new Error(`ConfigSnapshot is missing ${id}`);
  return data as readonly T[];
}
export function policyRules(
  snapshot: ConfigSnapshot,
): readonly RuntimePolicyRule[] {
  return snapshotArray<RuntimePolicyRule>(snapshot, "policyRules");
}
export function findPolicyRule(
  snapshot: ConfigSnapshot,
  id: string,
): RuntimePolicyRule {
  const rule = policyRules(snapshot).find((item) => item.policyId === id);
  if (!rule) throw new Error(`Unknown policy ${id}`);
  return rule;
}
export function createReservedPolicy(
  state: GameState,
  ruleId: string,
  value: number,
  policyId: string,
  quartersAhead = 0,
): PolicyDecision {
  const rule = findPolicyRule(state.configSnapshot, ruleId);
  validatePolicyInputs(rule, { value });
  if (
    !Number.isInteger(quartersAhead) ||
    quartersAhead < 0 ||
    quartersAhead > 3
  ) {
    throw new RangeError("Policy may be reserved at most three quarters ahead");
  }
  const cycle = state.clock.config.policyCycleSteps;
  const activationMonth =
    quartersAhead === 0
      ? state.monthIndex
      : (Math.floor(state.monthIndex / cycle) + quartersAhead) * cycle;
  const foreignReserves =
    rule.policyType === "fxIntervention"
      ? Math.max(0, value) * state.economy.indices.realGdp * 12
      : rule.costs.foreignReserves;
  return {
    policyId,
    type: rule.policyType as PolicyType,
    decidedMonth: state.monthIndex,
    activationMonth,
    endMonth: activationMonth + (rule.defaultDurationMonths ?? 12) - 1,
    status: "reserved",
    slotQuarter: Math.floor(state.monthIndex / cycle),
    costs: { ...rule.costs, foreignReserves },
    inputs: { value },
    reservationId: policyId,
    sourceCommandId: policyId,
  };
}
function modifier(
  id: PolicyEffectSpec["modifierIds"][number],
  state: GameState,
  rule: RuntimePolicyRule,
  value: number,
): number {
  const e = state.economy;
  const params = state.configSnapshot.normalizedConfig.parameters as Readonly<
    Record<string, number>
  >;
  const setting = (key: string): number => {
    const result = rule.modifierSettings?.[key];
    if (result === undefined || !Number.isFinite(result))
      throw new Error(`Missing policy modifier ${key}`);
    return result;
  };
  switch (id) {
    case "slack":
      return e.indices.realGdp / e.indices.potentialGdp - 1 <
        params["FISC-SLACK-THRESHOLD-001"]!
        ? (rule.regimeModifiers.stress ?? 1)
        : 1;
    case "capacity":
      return Math.min(
        1,
        (e.institutions.implementationCapacity * params["PINV-CAP-001"]!) /
          Math.max(1e-9, Math.abs(value) * 100),
      );
    case "debt":
      return Math.max(
        0,
        1 -
          params["PINV-DEBT-001"]! *
            Math.max(
              0,
              e.ratios.governmentDebtRatio - params["DEBT-RISK-001"]!,
            ),
      );
    case "reserves": {
      const months = e.stocks.foreignReserves / Math.max(1e-9, e.flows.imports);
      return months < setting("reserveLowMonths")
        ? setting("reserveLowEffectiveness")
        : months < setting("reserveMidMonths")
          ? setting("reserveMidEffectiveness")
          : 1;
    }
    case "repeat":
      return Math.max(
        setting("repeatFloor"),
        setting("repeatQuarterFactor") **
          state.policies.completed.filter(
            (p) =>
              p.type === "fxIntervention" &&
              state.monthIndex - p.decidedMonth < 12,
          ).length,
      );
    case "openness":
      return Math.max(
        0,
        Math.min(
          1,
          1 -
            e.industries.manufacturing.importDependency *
              setting("opennessLeakage"),
        ),
      );
    case "trust":
      return Math.max(
        0,
        Math.min(1, e.sentiment.policyTrust / setting("trustReference")),
      );
    case "retaliation":
      return Math.max(
        0,
        Math.min(
          1,
          setting("retaliationBase") *
            (1 + (50 - e.external.partnerRelations) / 100),
        ),
      );
  }
}
function effectsForRule(
  rule: RuntimePolicyRule,
  values: Readonly<Record<string, number>>,
  state: GameState,
): readonly ScheduledEffect[] {
  const value = values.value;
  if (value === undefined)
    throw new Error(`Missing value for ${rule.policyId}`);
  const kernels = snapshotArray<Kernel>(state.configSnapshot, "lagKernels");
  return (rule.effectSpecs ?? []).map((spec, index) => {
    if (!EFFECT_TARGETS.has(spec.targetPath))
      throw new Error(`Unsupported policy target ${spec.targetPath}`);
    const kernel = kernels.find((item) => item.kernelId === spec.kernelId);
    if (
      !kernel ||
      kernel.weights.length !== kernel.end - kernel.start + 1 ||
      Math.abs(kernel.weights.reduce((sum, weight) => sum + weight, 0) - 1) >
        1e-10
    ) {
      throw new Error(`Invalid policy kernel ${spec.kernelId}`);
    }
    const signed = value - (rule.referenceValue ?? 0);
    const input =
      spec.inputMode === "absoluteChange" ? Math.abs(signed) : signed;
    const factor = spec.modifierIds.reduce(
      (product, id) => product * modifier(id, state, rule, value),
      1,
    );
    const baseStrength =
      input *
      spec.inputScale *
      (spec.scaleBy === "gdp" ? state.economy.indices.realGdp : 1) *
      factor;
    if (!Number.isFinite(baseStrength))
      throw new Error(`Invalid effect strength for ${rule.policyId}`);
    return {
      effectId: `${rule.policyId}:${state.monthIndex}:${index}`,
      sourceType: "policy" as const,
      sourceId: rule.policyId,
      targetPath: spec.targetPath,
      operation: spec.operation,
      startMonth: state.monthIndex + kernel.start,
      endMonth: state.monthIndex + kernel.end,
      curveId: kernel.kernelId,
      weights: [...kernel.weights],
      totalWeight: 1,
      baseStrength,
      modifierIds: [...spec.modifierIds],
      uncertainty: { low: 0.8, high: 1.2 },
      role: spec.role,
      labelKey: `policy.${rule.policyId}`,
    };
  });
}

/** All configured policy types must have an explicit handler. Preview and activation use this registry. */
export function createConfiguredPolicyRegistry(snapshot: ConfigSnapshot) {
  const rules = policyRules(snapshot);
  const handlers: PolicyHandler[] = POLICY_TYPES.map((policyType) => ({
    policyType,
    createEffects({ rule, values, state }) {
      return effectsForRule(rule as RuntimePolicyRule, values, state);
    },
  }));
  const registry = createPolicyHandlerRegistry(rules, handlers);
  const kernels = snapshotArray<Kernel>(snapshot, "lagKernels");
  for (const rule of rules) {
    if (!rule.effectSpecs?.length)
      throw new Error(`Policy ${rule.policyId} has no scheduled effects`);
    for (const spec of rule.effectSpecs) {
      if (!EFFECT_TARGETS.has(spec.targetPath))
        throw new Error(`Unsupported policy target ${spec.targetPath}`);
      if (!kernels.some((item) => item.kernelId === spec.kernelId))
        throw new Error(`Invalid policy kernel ${spec.kernelId}`);
    }
  }
  return registry;
}

export interface ActivationResult {
  readonly state: GameState;
  readonly causal: readonly CausalContribution[];
}
/** Called inside tick's atomic draft, before demand and macro equations run. */
export function activateDuePolicies(state: GameState): ActivationResult {
  const due = state.policies.reserved.filter(
    (policy) => policy.activationMonth <= state.monthIndex,
  );
  const expired = state.policies.active.filter(
    (policy) =>
      policy.endMonth !== undefined && policy.endMonth < state.monthIndex,
  );
  const stillScheduled = state.effects.filter(
    (effect) => effect.endMonth >= state.monthIndex,
  );
  const completedSupply = state.effects
    .filter(
      (effect) =>
        effect.endMonth < state.monthIndex &&
        effect.targetPath === "economy.indices.potentialGdp",
    )
    .reduce((sum, effect) => sum + effect.baseStrength, 0);
  if (
    due.length === 0 &&
    expired.length === 0 &&
    stillScheduled.length === state.effects.length
  )
    return { state, causal: [] };
  const registry = createConfiguredPolicyRegistry(state.configSnapshot);
  let working =
    completedSupply === 0
      ? state
      : {
          ...state,
          economy: {
            ...state.economy,
            memory: {
              ...state.economy.memory,
              completedPolicyPotential:
                (state.economy.memory?.completedPolicyPotential ?? 0) +
                completedSupply,
            },
          },
        };
  const causal: CausalContribution[] = [];
  let effects = stillScheduled;
  const active = state.policies.active.filter(
    (policy) => !expired.includes(policy),
  );
  const completed = [
    ...state.policies.completed,
    ...expired.map((p) => ({ ...p, status: "completed" as const })),
  ];
  const interestExpires = expired.some((p) => p.type === "interestRate");
  if (
    interestExpires &&
    !active.some((p) => p.type === "interestRate") &&
    !due.some((p) => p.type === "interestRate")
  ) {
    const nation = working.configSnapshot.normalizedConfig.nation as {
      initial: { policyRate: number };
    };
    const next = nation.initial.policyRate;
    causal.push(
      createContributionBuilder("policyRate", working.economy.rates.policyRate)
        .add(
          {
            sourceType: "policy",
            sourceId: "interest-rate-expiry",
            labelKey: "policy.interest-rate",
            confidence: "high",
          },
          next - working.economy.rates.policyRate,
        )
        .build(next),
    );
    working = {
      ...working,
      economy: {
        ...working.economy,
        rates: { ...working.economy.rates, policyRate: percentRate(next) },
      },
    };
  }
  for (const policy of due) {
    if (policy.activationMonth !== state.monthIndex)
      throw new Error(`Overdue policy ${policy.policyId}`);
    const rule = findPolicyRule(
      working.configSnapshot,
      policy.type === "interestRate"
        ? "interest-rate"
        : policy.type === "taxPackage"
          ? "tax-package"
          : policy.type === "publicWorks"
            ? "public-works"
            : policy.type === "tariff"
              ? "tariff"
              : policy.type === "fxIntervention"
                ? "fx-intervention"
                : policy.type,
    );
    if (rule.policyType !== policy.type)
      throw new Error(`Policy type mismatch for ${policy.policyId}`);
    if (
      working.policyAdministration &&
      !working.policyAdministration.reservations.some(
        (reservation) =>
          reservation.policyId === policy.policyId &&
          JSON.stringify(reservation.costs) === JSON.stringify(policy.costs),
      )
    ) {
      throw new Error(`Missing resource reservation for ${policy.policyId}`);
    }
    const costs = policy.costs;
    if (
      working.resources.politicalCapital < costs.politicalCapital ||
      working.resources.implementationCapacity < costs.implementationCapacity ||
      working.resources.discretionaryBudget < costs.immediateBudget ||
      working.economy.stocks.foreignReserves < costs.foreignReserves
    ) {
      throw new Error(`Insufficient resources to activate ${policy.policyId}`);
    }
    const policyState = { ...working, monthIndex: policy.activationMonth };
    const generated = registry
      .createEffects(rule.policyId, policy.inputs ?? {}, policyState)
      .map((effect, index) => ({
        ...effect,
        effectId: `${policy.policyId}:${index}`,
        sourceId: policy.policyId,
      }));
    effects = [...effects, ...generated];
    const pc = working.resources.politicalCapital - costs.politicalCapital;
    const ic =
      working.resources.implementationCapacity - costs.implementationCapacity;
    const reserveDelta =
      -costs.foreignReserves +
      (policy.type === "fxIntervention" && (policy.inputs?.value ?? 0) < 0
        ? Math.abs(policy.inputs!.value!) * working.economy.indices.realGdp * 12
        : 0);
    const source = {
      sourceType: "policy" as const,
      sourceId: policy.policyId,
      labelKey: `policy.${rule.policyId}`,
      confidence: "high" as const,
    };
    for (const [metric, before, delta] of [
      [
        "politicalCapital",
        working.economy.institutions.politicalCapital,
        -costs.politicalCapital,
      ],
      [
        "implementationCapacity",
        working.economy.institutions.implementationCapacity,
        -costs.implementationCapacity,
      ],
      ["foreignReserves", working.economy.stocks.foreignReserves, reserveDelta],
    ] as const) {
      if (delta !== 0)
        causal.push(
          createContributionBuilder(metric, before)
            .add(source, delta)
            .build(before + delta),
        );
    }
    working = {
      ...working,
      resources: {
        ...working.resources,
        politicalCapital: scorePoint(pc),
        implementationCapacity: scorePoint(ic),
        discretionaryBudget: stockLevel(
          working.resources.discretionaryBudget - costs.immediateBudget,
        ),
      },
      economy: {
        ...working.economy,
        institutions: {
          ...working.economy.institutions,
          politicalCapital: scorePoint(pc),
          implementationCapacity: scorePoint(ic),
        },
        stocks: {
          ...working.economy.stocks,
          foreignReserves: stockLevel(
            working.economy.stocks.foreignReserves + reserveDelta,
          ),
        },
      },
    };
    if (policy.type === "interestRate") {
      const next = policy.inputs?.value;
      if (next === undefined)
        throw new Error("Interest-rate policy requires a value");
      causal.push(
        createContributionBuilder(
          "policyRate",
          working.economy.rates.policyRate,
        )
          .add(
            {
              sourceType: "policy",
              sourceId: policy.policyId,
              labelKey: "policy.interest-rate",
              confidence: "high",
            },
            next - working.economy.rates.policyRate,
          )
          .build(next),
      );
      working = {
        ...working,
        economy: {
          ...working.economy,
          rates: { ...working.economy.rates, policyRate: percentRate(next) },
        },
      };
    }
    active.push({
      ...policy,
      status: "active",
      endMonth:
        policy.endMonth ??
        policy.activationMonth + (rule.defaultDurationMonths ?? 12) - 1,
    });
  }
  const reservations = working.policyAdministration?.reservations.filter(
    (reservation) =>
      !due.some((policy) => policy.policyId === reservation.policyId),
  );
  return {
    state: {
      ...working,
      ...(working.policyAdministration && {
        policyAdministration: {
          ...working.policyAdministration,
          reservations: reservations ?? [],
        },
      }),
      resources: {
        ...working.resources,
        reservedForeignReserves: stockLevel(
          reservations?.reduce(
            (sum, item) => sum + item.costs.foreignReserves,
            0,
          ) ?? working.resources.reservedForeignReserves,
        ),
      },
      policies: {
        ...working.policies,
        active,
        completed,
        reserved: working.policies.reserved.filter((p) => !due.includes(p)),
      },
      effects,
    },
    causal,
  };
}

/** Stop future effect weights; past contributions and paid activation costs stay in history. */
export function terminateActivePolicy(
  state: GameState,
  policyId: string,
): ActivationResult {
  const policy = state.policies.active.find(
    (item) => item.policyId === policyId,
  );
  if (!policy) throw new Error(`No active policy ${policyId}`);
  const rule = policyRules(state.configSnapshot).find(
    (item) => item.policyType === policy.type,
  );
  if (!rule) throw new Error(`Unknown policy type ${policy.type}`);
  const cost = rule.terminationPoliticalCapital ?? 0;
  if (state.resources.politicalCapital < cost)
    throw new Error(`Insufficient political capital to terminate ${policyId}`);
  const parameters = state.configSnapshot.normalizedConfig
    .parameters as Readonly<Record<string, number>>;
  const trustPenalty = parameters["TRUST-REV-001"];
  if (typeof trustPenalty !== "number" || trustPenalty > 0)
    throw new Error("Invalid policy reversal penalty");
  const trustBefore = state.economy.sentiment.policyTrust;
  const trustAfter = Math.max(0, trustBefore + trustPenalty);
  const pcBefore = state.resources.politicalCapital;
  const pcAfter = pcBefore - cost;
  const source = {
    sourceType: "policy" as const,
    sourceId: policyId,
    labelKey: `policy.${rule.policyId}.termination`,
    confidence: "high" as const,
  };
  const causal = [
    createContributionBuilder("policyTrust", trustBefore)
      .add(source, trustAfter - trustBefore)
      .build(trustAfter),
    createContributionBuilder("politicalCapital", pcBefore)
      .add(source, -cost)
      .build(pcAfter),
  ];
  let policyRate = state.economy.rates.policyRate;
  if (policy.type === "interestRate") {
    const stillActive = state.policies.active.filter(
      (item) => item.policyId !== policyId && item.type === "interestRate",
    );
    policyRate = percentRate(
      stillActive.at(-1)?.inputs?.value ??
        (
          state.configSnapshot.normalizedConfig.nation as {
            initial: { policyRate: number };
          }
        ).initial.policyRate,
    );
    causal.push(
      createContributionBuilder("policyRate", state.economy.rates.policyRate)
        .add(source, policyRate - state.economy.rates.policyRate)
        .build(policyRate),
    );
  }
  return {
    state: {
      ...state,
      resources: { ...state.resources, politicalCapital: scorePoint(pcAfter) },
      economy: {
        ...state.economy,
        rates: { ...state.economy.rates, policyRate },
        institutions: {
          ...state.economy.institutions,
          politicalCapital: scorePoint(pcAfter),
        },
        sentiment: {
          ...state.economy.sentiment,
          policyTrust: scorePoint(trustAfter),
        },
      },
      policies: {
        ...state.policies,
        active: state.policies.active.filter(
          (item) => item.policyId !== policyId,
        ),
        completed: [
          ...state.policies.completed,
          { ...policy, status: "terminated", endMonth: state.monthIndex - 1 },
        ],
      },
      effects: state.effects.filter((effect) => effect.sourceId !== policyId),
    },
    causal,
  };
}
