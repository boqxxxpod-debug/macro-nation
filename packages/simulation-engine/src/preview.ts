import { endMonthForState } from "@macro-nation/domain";
import type {
  GameState,
  PolicyCosts,
  ScheduledEffect,
} from "@macro-nation/domain";
import {
  applyPolicyCommand,
  policyStateHash,
  type PolicyDraft,
} from "./commands";
import { runPolicyHeadless, type NoPolicyRunResult } from "./headless";
import { previewQuantile } from "./rng";
import { ENGINE_VERSION } from "./version";
import type { TickRngProvider } from "./tick";

export const PREVIEW_INDICATORS = [
  "realGdp",
  "potentialGdp",
  "inflation",
  "unemployment",
  "policyRate",
  "fx",
  "governmentDebtRatio",
  "fiscalBalanceRatio",
  "policyTrust",
  "support",
  "foreignReserves",
  "primarySpending",
] as const;
export type PreviewIndicator = (typeof PREVIEW_INDICATORS)[number];
type Scenario = "pessimistic" | "base" | "optimistic";
const SCENARIOS: readonly Scenario[] = ["pessimistic", "base", "optimistic"];
const ZERO_COSTS: PolicyCosts = {
  politicalCapital: 0,
  implementationCapacity: 0,
  foreignReserves: 0,
  immediateBudget: 0,
};

export interface PreviewInput {
  readonly state: GameState;
  readonly draft: PolicyDraft | null;
  /** A shorter calculation is allowed; the standard report includes the five-year IRF. */
  readonly horizonMonths?: 12 | 60;
  readonly shockPairingId?: string;
}

export interface PreviewRange {
  readonly low: number;
  readonly base: number;
  readonly high: number;
  /** Absolute difference between the proposed policy and unchanged baseline. */
  readonly deltaLow: number;
  readonly deltaBase: number;
  readonly deltaHigh: number;
}

export interface IrfSummary {
  readonly indicatorId: PreviewIndicator;
  readonly horizonMonths: number;
  readonly peakMonth: number;
  readonly peakDelta: number;
  readonly cumulativeDelta: number;
  readonly reverses: boolean;
  readonly endDelta: number;
}

export interface PreviewOutput {
  readonly stateHash: string;
  readonly draftHash: string;
  readonly cacheKey: string;
  readonly shockPairingId: string;
  readonly configHash: string;
  readonly calibrationVersion: string;
  readonly engineVersion: string;
  readonly horizonMonths: 12 | 60;
  readonly previewedDraft: PolicyDraft | null;
  readonly activationMonth: number | null;
  readonly indicators: readonly {
    readonly indicatorId: PreviewIndicator;
    readonly month3: PreviewRange;
    readonly month6: PreviewRange;
    readonly month12: PreviewRange;
  }[];
  /** The 12-month and five-year descriptions derive from the same paired series. */
  readonly summaries: readonly IrfSummary[];
  readonly irf: Readonly<Record<PreviewIndicator, readonly number[]>>;
  readonly primaryEffects: readonly ScheduledEffect[];
  readonly sideEffects: readonly ScheduledEffect[];
  readonly costs: PolicyCosts;
  readonly modeledNetPrimarySpending: number;
  readonly interactions: readonly string[];
  readonly uncertainty: {
    readonly method: "fixed-shock-quantiles";
    readonly quantiles: readonly [0.16, 0.5, 0.84];
    readonly majorDrivers: readonly PreviewIndicator[];
    readonly note: string;
  };
}

function hash(input: string): string {
  let value = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(input)) {
    value ^= BigInt(byte);
    value = (value * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return value.toString(16).padStart(16, "0");
}

export function policyDraftHash(draft: PolicyDraft | null): string {
  if (!draft) return "no-policy";
  return hash(
    JSON.stringify([
      draft.policyId,
      draft.ruleId,
      draft.value,
      draft.quartersAhead,
    ]),
  );
}

export function previewCacheKey(input: PreviewInput): string {
  const horizon = input.horizonMonths ?? 60;
  return JSON.stringify([
    input.state.configSnapshot.configHash,
    input.state.versions.calibrationVersion,
    input.state.versions.engineVersion,
    policyStateHash(input.state),
    policyDraftHash(input.draft),
    horizon,
    input.shockPairingId ?? `fixed-quantiles:${input.state.rng.rootSeed}`,
  ]);
}

/** Quantiles replace only future error draws; both arms retain the same state and model. */
function quantileProvider(scenario: Scenario): TickRngProvider {
  const quantile = previewQuantile(scenario);
  return {
    rngVersion: "xoshiro128ss-v1",
    cloneBundle: (bundle) => structuredClone(bundle),
    drawFloat01: (bundle) => ({ value: quantile, bundle }),
    drawUint32: (bundle) => ({
      value: Math.floor(quantile * 0x1_0000_0000),
      bundle,
    }),
  };
}

function metric(state: GameState, id: PreviewIndicator): number {
  const { economy: e } = state;
  switch (id) {
    case "realGdp":
    case "potentialGdp":
    case "fx":
      return e.indices[id];
    case "inflation":
      return e.rates.inflationAnnual;
    case "unemployment":
    case "policyRate":
      return e.rates[id];
    case "governmentDebtRatio":
    case "fiscalBalanceRatio":
      return e.ratios[id];
    case "policyTrust":
    case "support":
      return e.sentiment[id];
    case "foreignReserves":
      return e.stocks.foreignReserves;
    case "primarySpending":
      return e.flows.primarySpending;
  }
}

function checked(result: NoPolicyRunResult): NoPolicyRunResult {
  if (result.failure)
    throw new Error(
      `Preview failed at month ${result.failure.monthIndex}: ${result.failure.message}`,
    );
  return result;
}

function range(
  values: Readonly<Record<Scenario, readonly number[]>>,
  baselines: Readonly<Record<Scenario, readonly number[]>>,
  month: number,
): PreviewRange {
  const index = month - 1;
  const levels = SCENARIOS.map((scenario) => values[scenario][index]!);
  const deltas = SCENARIOS.map(
    (scenario) => values[scenario][index]! - baselines[scenario][index]!,
  );
  return {
    low: Math.min(...levels),
    base: values.base[index]!,
    high: Math.max(...levels),
    deltaLow: Math.min(...deltas),
    deltaBase: deltas[1]!,
    deltaHigh: Math.max(...deltas),
  };
}

function summary(
  indicatorId: PreviewIndicator,
  horizonMonths: number,
  series: readonly number[],
): IrfSummary {
  const values = series.slice(0, horizonMonths);
  const peak = values.reduce(
    (best, value, index) =>
      Math.abs(value) > Math.abs(values[best]!) ? index : best,
    0,
  );
  const signs = values.filter((value) => Math.abs(value) > 1e-8).map(Math.sign);
  return {
    indicatorId,
    horizonMonths,
    peakMonth: peak + 1,
    peakDelta: values[peak]!,
    cumulativeDelta: values.reduce((sum, value) => sum + value, 0),
    reverses: signs.some((sign) => sign !== signs[0]),
    endDelta: values.at(-1)!,
  };
}

/** Pure paired model run. A UI commits previewedDraft against the returned stateHash. */
export function previewPolicy(input: PreviewInput): PreviewOutput {
  const horizonMonths = input.horizonMonths ?? 60;
  if (horizonMonths !== 12 && horizonMonths !== 60)
    throw new RangeError("Preview horizon must be 12 or 60 months");
  const stateHash = policyStateHash(input.state);
  const draftHash = policyDraftHash(input.draft);
  const previewedDraft: PolicyDraft | null = input.draft && {
    ...input.draft,
    status: "previewed",
    previewStateHash: stateHash,
  };
  const variant = previewedDraft
    ? applyPolicyCommand(input.state, {
        kind: "commit",
        commandId: `preview-${draftHash}`,
        expectedStateHash: stateHash,
        draft: previewedDraft,
      }).state
    : input.state;
  const policy = variant.policies.reserved.find(
    (item) => item.policyId === previewedDraft?.policyId,
  );
  const levels = {} as Record<
    PreviewIndicator,
    Record<Scenario, readonly number[]>
  >;
  const baselines = {} as Record<
    PreviewIndicator,
    Record<Scenario, readonly number[]>
  >;
  for (const id of PREVIEW_INDICATORS) {
    levels[id] = {} as Record<Scenario, readonly number[]>;
    baselines[id] = {} as Record<Scenario, readonly number[]>;
  }
  let effects: readonly ScheduledEffect[] = [];
  for (const scenario of SCENARIOS) {
    const rngProvider = quantileProvider(scenario);
    // A preview is a disposable counterfactual. A five-year outlook may extend
    // past a short game's finish without allowing the saved game to advance.
    const projectionEndMonth = Math.max(
      endMonthForState(input.state),
      input.state.monthIndex + horizonMonths,
    );
    const projectionState = (state: GameState): GameState => ({
      ...state,
      runState: "running",
      clock: { ...state.clock, endMonth: projectionEndMonth },
    });
    const base = checked(
      runPolicyHeadless({
        initialState: projectionState(input.state),
        tickCount: horizonMonths,
        rngProvider,
      }),
    );
    const proposed =
      variant === input.state
        ? base
        : checked(
            runPolicyHeadless({
              initialState: projectionState(variant),
              tickCount: horizonMonths,
              rngProvider,
            }),
          );
    if (
      base.finalState.configSnapshot.configHash !==
        proposed.finalState.configSnapshot.configHash ||
      base.finalState.versions.calibrationVersion !==
        proposed.finalState.versions.calibrationVersion
    )
      throw new Error("Preview arms have different model snapshots");
    for (let index = 0; index < horizonMonths; index += 1) {
      if (
        JSON.stringify(base.records[index]!.state.rng) !==
        JSON.stringify(proposed.records[index]!.state.rng)
      )
        throw new Error("Preview shock streams diverged");
    }
    for (const id of PREVIEW_INDICATORS) {
      levels[id][scenario] = proposed.records.map((row) =>
        metric(row.state, id),
      );
      baselines[id][scenario] = base.records.map((row) =>
        metric(row.state, id),
      );
    }
    if (scenario === "base" && policy) {
      const seen = new Set<string>();
      effects = proposed.records.flatMap((row) =>
        row.state.effects.filter((effect) => {
          if (effect.sourceId !== policy.policyId || seen.has(effect.effectId))
            return false;
          seen.add(effect.effectId);
          return true;
        }),
      );
    }
  }
  const irf = {} as Record<PreviewIndicator, readonly number[]>;
  const indicators = PREVIEW_INDICATORS.map((indicatorId) => {
    const values = levels[indicatorId];
    const base = baselines[indicatorId];
    irf[indicatorId] = values.base.map(
      (value, index) => value - base.base[index]!,
    );
    return {
      indicatorId,
      month3: range(values, base, 3),
      month6: range(values, base, 6),
      month12: range(values, base, 12),
    };
  });
  const summaries = [12, ...(horizonMonths === 60 ? [60] : [])].flatMap(
    (months) => PREVIEW_INDICATORS.map((id) => summary(id, months, irf[id]!)),
  );
  const majorDrivers = [...indicators]
    .sort(
      (a, b) =>
        b.month12.deltaHigh -
        b.month12.deltaLow -
        (a.month12.deltaHigh - a.month12.deltaLow),
    )
    .slice(0, 3)
    .map((item) => item.indicatorId);
  return {
    stateHash,
    draftHash,
    cacheKey: previewCacheKey(input),
    shockPairingId:
      input.shockPairingId ?? `fixed-quantiles:${input.state.rng.rootSeed}`,
    configHash: input.state.configSnapshot.configHash,
    calibrationVersion: input.state.versions.calibrationVersion,
    engineVersion: ENGINE_VERSION,
    horizonMonths,
    previewedDraft,
    activationMonth: policy?.activationMonth ?? null,
    indicators,
    summaries,
    irf,
    primaryEffects: effects.filter((effect) => effect.role === "primary"),
    sideEffects: effects.filter((effect) => effect.role === "sideEffect"),
    costs: policy?.costs ?? ZERO_COSTS,
    modeledNetPrimarySpending: irf.primarySpending.reduce(
      (total, value) => total + value,
      0,
    ),
    interactions: policy
      ? [...input.state.policies.active, ...input.state.policies.reserved]
          .filter((existing) => existing.type === policy.type)
          .map((existing) => existing.policyId)
      : [],
    uncertainty: {
      method: "fixed-shock-quantiles",
      quantiles: [0.16, 0.5, 0.84],
      majorDrivers,
      note: "同一モデルの固定ショック分位による試算幅であり、確率的な信頼区間ではありません。",
    },
  };
}
