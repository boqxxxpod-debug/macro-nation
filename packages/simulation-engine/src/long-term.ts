import {
  INDUSTRY_IDS,
  endMonthForState,
  indexLevel,
  milestoneKey,
  share01,
  type CausalContribution,
  type GameState,
  type IndustryId,
  type ReviewSnapshot,
} from "@macro-nation/domain";
import { createContributionBuilder } from "./causal";

interface LongTermRules {
  readonly populationAnnualGrowth: number;
  readonly technologyDecadeGain: number;
  readonly infrastructureDecadeWear: number;
  readonly employmentShiftPerDecade: number;
  readonly shiftFrom: IndustryId;
  readonly shiftTo: IndustryId;
}

function scenario(state: GameState): {
  readonly durations?: readonly {
    readonly id: string;
    readonly reviewIntervalMonths: number;
    readonly structuralIntervalMonths: number;
  }[];
  readonly longTerm?: LongTermRules;
} {
  return (state.configSnapshot.normalizedConfig.scenario ?? {}) as ReturnType<
    typeof scenario
  >;
}

function intervals(state: GameState) {
  const chosen = scenario(state).durations?.find(
    (item) => item.id === state.clock.durationMode,
  );
  // Every duration currently uses the same intervals. The values come from the
  // saved scenario so future runs can change the intervals without changing code.
  const config = chosen ?? scenario(state).durations?.[0];
  return {
    review: config?.reviewIntervalMonths ?? 60,
    structure: config?.structuralIntervalMonths ?? 120,
  };
}

/** Applied after economic stages, before the tick commits; no wall clock or RNG. */
export function applyLongTermMilestone(state: GameState): {
  readonly state: GameState;
  readonly causal: readonly CausalContribution[];
} {
  const month = state.monthIndex + 1;
  const config = scenario(state).longTerm;
  const { structure } = intervals(state);
  const key = milestoneKey(state.gameId, "structure", month);
  if (
    !config ||
    month % structure !== 0 ||
    (state.history.appliedMilestones ?? []).includes(key)
  )
    return { state, causal: [] };
  if (
    !INDUSTRY_IDS.includes(config.shiftFrom) ||
    !INDUSTRY_IDS.includes(config.shiftTo) ||
    config.shiftFrom === config.shiftTo
  )
    throw new Error("Invalid long-term industry shift configuration");

  const previousPopulation =
    state.longTerm?.population ??
    (state.configSnapshot.normalizedConfig.nation as { population: number })
      .population;
  const previousTechnology = state.longTerm?.technologyIndex ?? 100;
  const population =
    previousPopulation *
    (1 + config.populationAnnualGrowth) ** (structure / 12);
  const technologyIndex =
    previousTechnology * (1 + config.technologyDecadeGain);
  const factor =
    (population / previousPopulation) * (technologyIndex / previousTechnology);
  const beforePotential = state.economy.indices.potentialGdp;
  const potentialGdp = indexLevel(beforePotential * factor);
  const baselinePotentialGdp = indexLevel(
    (state.economy.memory?.baselinePotentialGdp ?? beforePotential) * factor,
  );
  const from = state.economy.industries[config.shiftFrom];
  const to = state.economy.industries[config.shiftTo];
  const shifted = Math.min(
    from.employmentShare,
    config.employmentShiftPerDecade,
  );
  const industries = {
    ...state.economy.industries,
    [config.shiftFrom]: {
      ...from,
      employmentShare: share01(from.employmentShare - shifted),
    },
    [config.shiftTo]: {
      ...to,
      employmentShare: share01(to.employmentShare + shifted),
    },
  };
  const infrastructure = { ...state.economy.infrastructure };
  const causal: CausalContribution[] = [
    createContributionBuilder("population", previousPopulation)
      .add(
        {
          sourceType: "external",
          sourceId: key,
          labelKey: "longTerm.population",
          confidence: "medium",
        },
        population - previousPopulation,
      )
      .build(population),
    createContributionBuilder("technologyIndex", previousTechnology)
      .add(
        {
          sourceType: "external",
          sourceId: key,
          labelKey: "longTerm.technology",
          confidence: "medium",
        },
        technologyIndex - previousTechnology,
      )
      .build(technologyIndex),
    createContributionBuilder("potentialGdp", beforePotential)
      .add(
        {
          sourceType: "external",
          sourceId: key,
          labelKey: "longTerm.demographyTechnology",
          confidence: "medium",
        },
        potentialGdp - beforePotential,
      )
      .build(potentialGdp),
  ];
  for (const [id, before, after] of [
    [config.shiftFrom, from.employmentShare, from.employmentShare - shifted],
    [config.shiftTo, to.employmentShare, to.employmentShare + shifted],
  ] as const) {
    causal.push(
      createContributionBuilder(`industry.${id}.employment`, before)
        .add(
          {
            sourceType: "external",
            sourceId: key,
            labelKey: "longTerm.industryShift",
            confidence: "medium",
          },
          after - before,
        )
        .build(after),
    );
  }
  for (const id of Object.keys(
    infrastructure,
  ) as (keyof typeof infrastructure)[]) {
    const before = infrastructure[id];
    const after = indexLevel(before * (1 - config.infrastructureDecadeWear));
    infrastructure[id] = after;
    causal.push(
      createContributionBuilder(id, before)
        .add(
          {
            sourceType: "external",
            sourceId: key,
            labelKey: "longTerm.infrastructureWear",
            confidence: "medium",
          },
          after - before,
        )
        .build(after),
    );
  }
  return {
    state: {
      ...state,
      longTerm: { population, technologyIndex },
      economy: {
        ...state.economy,
        indices: { ...state.economy.indices, potentialGdp },
        memory: { ...state.economy.memory, baselinePotentialGdp },
        industries,
        infrastructure,
      },
      history: {
        ...state.history,
        appliedMilestones: [...(state.history.appliedMilestones ?? []), key],
      },
    },
    causal,
  };
}

const clip = (value: number) => Math.max(0, Math.min(100, value));

export function appendReview(
  state: GameState,
  causal: readonly CausalContribution[],
): GameState {
  const { review } = intervals(state);
  const month = state.monthIndex;
  const key = milestoneKey(state.gameId, "review", month);
  if (
    month % review !== 0 ||
    (state.history.appliedMilestones ?? []).includes(key)
  )
    return state;
  const e = state.economy;
  const initial = state.history.reports?.[0]?.values;
  const baselineGdp =
    initial?.realGdp ??
    (
      state.configSnapshot.normalizedConfig.nation as {
        initial: { realGdp: number };
      }
    ).initial.realGdp;
  const baselineIncome = initial?.realHouseholdIncome ?? baselineGdp;
  const reviewSnapshot: ReviewSnapshot = {
    monthIndex: month,
    axes: {
      living: clip(
        50 + (e.indices.realHouseholdIncome / baselineIncome - 1) * 100,
      ),
      growth: clip(50 + (e.indices.realGdp / baselineGdp - 1) * 100),
      stability: clip(
        100 -
          Math.abs(e.rates.inflationAnnual - 0.02) * 500 -
          e.rates.unemployment * 200,
      ),
      sustainability: clip(100 - e.ratios.governmentDebtRatio * 40),
      trust: clip(e.sentiment.policyTrust),
    },
    policyIds: [...state.policies.active, ...state.policies.completed]
      .map((policy) => policy.policyId)
      .sort(),
    crisisMonths: state.crisisCounters.unresolved ?? 0,
    causeRefs: causal
      .flatMap((entry) => entry.contributions.map((term) => term.sourceId))
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, 8),
  };
  return {
    ...state,
    history: {
      ...state.history,
      lastReviewMonth: month,
      reviews: [...(state.history.reviews ?? []), reviewSnapshot],
      appliedMilestones: [...(state.history.appliedMilestones ?? []), key],
    },
  };
}

export function durationReached(state: GameState): boolean {
  return state.monthIndex >= endMonthForState(state);
}
