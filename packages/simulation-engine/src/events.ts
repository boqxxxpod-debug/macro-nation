import type {
  CausalContribution,
  CausalMetricId,
  EventOccurrence,
  EventWarning,
  GameState,
} from "@macro-nation/domain";
import type { TickStageHandler } from "./tick";

type Comparator = "lt" | "lte" | "gt" | "gte";
interface EventCondition {
  readonly path: string;
  readonly op: Comparator;
  readonly value: number;
}
interface PreparednessIndicator {
  readonly id: string;
  readonly path: string;
  readonly goodAt: number;
  readonly badAt: number;
  readonly weight: number;
}
interface EventDefinition {
  readonly eventId: string;
  readonly title: string;
  readonly condition: readonly EventCondition[];
  readonly leadingIndicators: readonly EventCondition[];
  readonly baseMonthlyProbability: number;
  readonly cooldownMonths: number;
  readonly requiresChoice: boolean;
  readonly preparednessIndicators: readonly PreparednessIndicator[];
  readonly mitigationCurve: readonly {
    preparedness: number;
    mitigation: number;
  }[];
  readonly damage: {
    readonly indicatorId: CausalMetricId;
    readonly path: string;
    readonly amount: number;
  };
}

function atPath(source: unknown, path: string): number {
  let value: unknown = source;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object") return Number.NaN;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "number" ? value : Number.NaN;
}

function withNumberAtPath(
  state: GameState,
  path: string,
  value: number,
): GameState {
  const root = structuredClone(state) as unknown as Record<string, unknown>;
  const parts = path.split(".");
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next))
      throw new Error(`Event damage path is invalid: ${path}`);
    cursor = next as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
  return root as unknown as GameState;
}

function matches(value: number, condition: EventCondition): boolean {
  if (!Number.isFinite(value)) return false;
  if (condition.op === "lt") return value < condition.value;
  if (condition.op === "lte") return value <= condition.value;
  if (condition.op === "gt") return value > condition.value;
  return value >= condition.value;
}

function conditionMatches(
  state: GameState,
  condition: EventCondition,
): boolean {
  return matches(atPath(state, condition.path), condition);
}

function preparedness(
  state: GameState,
  indicators: readonly PreparednessIndicator[],
) {
  let weighted = 0;
  let weights = 0;
  const missing: string[] = [];
  for (const item of indicators) {
    const value = atPath(state, item.path);
    const score = Math.max(
      0,
      Math.min(1, (value - item.badAt) / (item.goodAt - item.badAt)),
    );
    weighted += score * item.weight;
    weights += item.weight;
    if (score < 0.5) missing.push(item.id);
  }
  return { score: weights > 0 ? weighted / weights : 0, missing };
}

function interpolate(
  points: readonly { preparedness: number; mitigation: number }[],
  score: number,
): number {
  const sorted = [...points].sort((a, b) => a.preparedness - b.preparedness);
  if (score <= sorted[0]!.preparedness) return sorted[0]!.mitigation;
  for (let index = 1; index < sorted.length; index += 1) {
    const upper = sorted[index]!;
    const lower = sorted[index - 1]!;
    if (score <= upper.preparedness) {
      const ratio =
        (score - lower.preparedness) /
        (upper.preparedness - lower.preparedness);
      return lower.mitigation + (upper.mitigation - lower.mitigation) * ratio;
    }
  }
  return sorted.at(-1)!.mitigation;
}

function definitions(state: GameState): readonly EventDefinition[] {
  const content = state.configSnapshot.normalizedConfig.content as
    { events?: readonly EventDefinition[] } | undefined;
  const scenario = state.configSnapshot.normalizedConfig.scenario as
    { enabledEvents?: readonly string[] } | undefined;
  const enabled = new Set(scenario?.enabledEvents ?? []);
  return (content?.events ?? [])
    .filter((event) => enabled.has(event.eventId))
    .sort((a, b) => a.eventId.localeCompare(b.eventId));
}

function contribution(
  definition: EventDefinition,
  before: number,
  baseline: number,
  mitigation: number,
): CausalContribution {
  return {
    indicatorId: definition.damage.indicatorId,
    beforeValue: before,
    afterValue: before + baseline + mitigation,
    totalDelta: baseline + mitigation,
    contributions: [
      {
        sourceType: "event",
        sourceId: definition.eventId,
        labelKey: `event.${definition.eventId}.baselineDamage`,
        confidence: "high",
        delta: baseline,
      },
      {
        sourceType: "event",
        sourceId: `${definition.eventId}:preparedness`,
        labelKey: `event.${definition.eventId}.preparednessMitigation`,
        confidence: "high",
        delta: mitigation,
      },
    ],
    diagnostics: [],
  };
}

/** Deterministic monthly event stage. Every event owns an independent RNG stream. */
export const evaluateEvents: TickStageHandler = ({ state, context }) => {
  const warnings: EventWarning[] = [];
  let rng = state.rng;
  for (const definition of definitions(state)) {
    const prep = preparedness(state, definition.preparednessIndicators);
    const leading = definition.leadingIndicators.filter((item) =>
      conditionMatches(state, item),
    );
    if (leading.length > 0)
      warnings.push({
        eventId: definition.eventId,
        severity: Math.min(3, leading.length) as 1 | 2 | 3,
        preparedness: prep.score,
        missingIndicatorIds: prep.missing,
      });
    const cooldown = state.events.cooldownUntilMonth[definition.eventId] ?? -1;
    if (
      context.inputMonthIndex < cooldown ||
      !definition.condition.every((item) => conditionMatches(state, item))
    )
      continue;
    const draw = context.rngProvider.drawFloat01(
      rng,
      `event.${definition.eventId}`,
    );
    rng = draw.bundle;
    if (draw.value >= definition.baseMonthlyProbability) continue;
    const mitigationRate = Math.max(
      0,
      Math.min(1, interpolate(definition.mitigationCurve, prep.score)),
    );
    const baselineDamage = definition.damage.amount;
    const preparednessMitigation = -baselineDamage * mitigationRate;
    const occurrence: EventOccurrence = {
      eventId: definition.eventId,
      occurredMonth: context.inputMonthIndex,
      preparedness: prep.score,
      baselineDamage,
      preparednessMitigation,
      choiceMitigation: 0,
      targetPath: definition.damage.path,
    };
    const before = atPath(state, definition.damage.path);
    const damaged = withNumberAtPath(
      state,
      definition.damage.path,
      before + baselineDamage + preparednessMitigation,
    );
    return {
      state: {
        ...damaged,
        rng,
        runState: definition.requiresChoice ? "awaitingEvent" : state.runState,
        events: {
          ...state.events,
          activeEventIds: [...state.events.activeEventIds, definition.eventId],
          ...(definition.requiresChoice
            ? { pendingChoiceEventId: definition.eventId }
            : {}),
          warnings,
          occurrences: [...(state.events.occurrences ?? []), occurrence],
          cooldownUntilMonth: {
            ...state.events.cooldownUntilMonth,
            [definition.eventId]:
              context.inputMonthIndex + definition.cooldownMonths,
          },
        },
      },
      causal: [
        contribution(
          definition,
          before,
          baselineDamage,
          preparednessMitigation,
        ),
      ],
      notes: [`event:${definition.eventId}:occurred`],
    };
  }
  return { state: { ...state, rng, events: { ...state.events, warnings } } };
};
