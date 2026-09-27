import type {
  CausalContribution,
  CausalRef,
  GameState,
  PolicyDecision,
  ReactionAudience,
  ReactionSnapshot,
} from "@macro-nation/domain";

const AUDIENCES: readonly ReactionAudience[] = [
  "citizens",
  "business",
  "market",
];

interface AudienceConfig {
  readonly lagMonths: number;
  readonly costWeight: number;
  readonly metricWeights: Readonly<Record<string, number>>;
}

interface ReactionConfig {
  readonly neutralThreshold: number;
  readonly strengthThresholds: readonly [number, number, number];
  readonly sourceWeights: Readonly<Record<string, number>>;
  readonly metricScales: Readonly<Record<string, number>>;
  readonly audiences: Readonly<Record<ReactionAudience, AudienceConfig>>;
}

function configFor(state: GameState): ReactionConfig {
  const model = state.configSnapshot.normalizedConfig.model as
    { readonly reactions?: ReactionConfig } | undefined;
  if (!model?.reactions) throw new Error("Reaction model config is required");
  return model.reactions;
}

function refKey(ref: CausalRef): string {
  return [ref.sourceType, ref.sourceId, ref.effectId ?? "", ref.labelKey].join(
    ":",
  );
}

interface ScoredCause {
  readonly ref: CausalRef;
  readonly score: number;
}

function compareScoredCauses(left: ScoredCause, right: ScoredCause): number {
  return (
    Math.abs(right.score) - Math.abs(left.score) ||
    refKey(left.ref).localeCompare(refKey(right.ref))
  );
}

function policyCost(state: GameState, sourceId: string): number {
  const policies: readonly PolicyDecision[] = [
    ...state.policies.active,
    ...state.policies.reserved,
    ...state.policies.completed,
  ];
  const policy = policies.find((candidate) => candidate.policyId === sourceId);
  if (!policy) return 0;
  return (
    policy.costs.politicalCapital / 100 +
    policy.costs.implementationCapacity / 100 +
    policy.costs.foreignReserves /
      Math.max(1, state.economy.stocks.foreignReserves) +
    policy.costs.immediateBudget /
      Math.max(1, state.resources.discretionaryBudget)
  );
}

export function evaluateReactions(
  state: GameState,
  causal: readonly CausalContribution[],
): readonly ReactionSnapshot[] {
  const config = configFor(state);
  return AUDIENCES.map((audience) => {
    const audienceConfig = config.audiences[audience];
    const metricSignals = causal.flatMap((contribution) => {
      const metricWeight =
        audienceConfig.metricWeights[contribution.indicatorId] ?? 0;
      const scale = config.metricScales[contribution.indicatorId] ?? 1;
      return contribution.contributions.map((term) => ({
        ref: term as CausalRef,
        score:
          (term.delta / scale) *
          metricWeight *
          (config.sourceWeights[term.sourceType] ?? 0),
      }));
    });

    // A policy can contribute to several indicators. Its implementation cost is
    // a property of the decision, not of every causal term, so charge it once
    // and attach it to that policy's canonical causal reference.
    const policyRefs = new Map<string, CausalRef>();
    for (const signal of [...metricSignals].sort(compareScoredCauses)) {
      if (
        signal.ref.sourceType === "policy" &&
        !policyRefs.has(signal.ref.sourceId)
      )
        policyRefs.set(signal.ref.sourceId, signal.ref);
    }
    const chargedPolicies = new Set<string>();
    const scored = metricSignals.map((signal) => {
      if (
        signal.ref.sourceType !== "policy" ||
        chargedPolicies.has(signal.ref.sourceId) ||
        refKey(policyRefs.get(signal.ref.sourceId) ?? signal.ref) !==
          refKey(signal.ref)
      )
        return signal;
      chargedPolicies.add(signal.ref.sourceId);
      return {
        ...signal,
        score:
          signal.score +
          policyCost(state, signal.ref.sourceId) * audienceConfig.costWeight,
      };
    });
    const ordered = [...scored].sort(compareScoredCauses);
    const score = Math.max(
      -1,
      Math.min(
        1,
        ordered.reduce((total, item) => total + item.score, 0),
      ),
    );
    const absolute = Math.abs(score);
    const direction: -1 | 0 | 1 =
      absolute < config.neutralThreshold ? 0 : score < 0 ? -1 : 1;
    const strength: 0 | 1 | 2 | 3 =
      direction === 0
        ? 0
        : absolute < config.strengthThresholds[0]
          ? 1
          : absolute < config.strengthThresholds[1]
            ? 2
            : 3;
    const causeRefs = ordered
      .filter((item) => Math.abs(item.score) > 0)
      .filter(
        (item, index, all) =>
          all.findIndex(
            (candidate) => refKey(candidate.ref) === refKey(item.ref),
          ) === index,
      )
      .slice(0, 1)
      .map((item) => item.ref);
    const fallback = causal.flatMap((item) => item.contributions)[0];
    if (causeRefs.length === 0 && fallback) causeRefs.push(fallback);
    const topic = ordered[0]?.ref.labelKey ?? fallback?.labelKey;
    if (!topic || causeRefs.length === 0)
      throw new Error(
        "ReactionSnapshot requires at least one causal reference",
      );
    return {
      reactionId: `reaction:${state.monthIndex + 1}:${audience}`,
      month: state.monthIndex + 1,
      audience,
      direction,
      strength,
      lagMonths: audienceConfig.lagMonths,
      causeRefs,
      representativeTopicKey: topic,
    };
  });
}

/** Shared deterministic selector for Nation Voice, crises, history and nation view. */
export function selectRepresentativeReaction(
  reactions: readonly ReactionSnapshot[],
  audience?: ReactionAudience,
): ReactionSnapshot | undefined {
  return [...reactions]
    .filter(
      (reaction) => audience === undefined || reaction.audience === audience,
    )
    .sort(
      (left, right) =>
        right.strength - left.strength ||
        right.month - left.month ||
        left.audience.localeCompare(right.audience),
    )[0];
}

export function attachReactionReferences(
  state: GameState,
  reactions: readonly ReactionSnapshot[],
): GameState {
  const byPolicy = new Map<string, string[]>();
  for (const reaction of reactions) {
    for (const ref of reaction.causeRefs) {
      if (ref.sourceType !== "policy") continue;
      const ids = byPolicy.get(ref.sourceId) ?? [];
      if (!ids.includes(reaction.reactionId)) ids.push(reaction.reactionId);
      byPolicy.set(ref.sourceId, ids);
    }
  }
  const update = (policy: PolicyDecision): PolicyDecision => ({
    ...policy,
    reactionIds: [
      ...(policy.reactionIds ?? []),
      ...(byPolicy.get(policy.policyId) ?? []),
    ].filter((id, index, all) => all.indexOf(id) === index),
  });
  return {
    ...state,
    policies: {
      active: state.policies.active.map(update),
      reserved: state.policies.reserved.map(update),
      completed: state.policies.completed.map(update),
      cancelled: state.policies.cancelled.map(update),
    },
  };
}
