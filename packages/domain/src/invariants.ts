import type { GameState, RunState, VersionTuple } from "./state";

export type ValidationIssueCode =
  | "NOT_FINITE"
  | "OUT_OF_RANGE"
  | "NEGATIVE_VALUE"
  | "INVALID_CLOCK"
  | "POLICY_ID_DUPLICATE"
  | "EFFECT_WEIGHT_MISMATCH"
  | "DEBT_COMPONENT_MISMATCH"
  | "HISTORY_ORDER"
  | "INVALID_RNG_STATE"
  | "VERSION_MISMATCH";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export class DomainInvariantError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "DomainInvariantError";
    this.issues = issues;
  }
}

const TERMINAL_STATES = new Set<RunState>(["completed", "failed"]);

const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  running: ["running", "paused", "calculating", "awaitingEvent", "crisisStopped", "completed", "failed"],
  paused: ["paused", "running", "calculating", "completed", "failed"],
  calculating: ["running", "paused", "awaitingEvent", "crisisStopped", "completed", "failed"],
  awaitingEvent: ["awaitingEvent", "running", "paused", "crisisStopped", "completed", "failed"],
  crisisStopped: ["crisisStopped", "running", "paused", "awaitingEvent", "completed", "failed"],
  completed: ["completed"],
  failed: ["failed"],
};

export function canTransitionRunState(from: RunState, to: RunState): boolean {
  if (TERMINAL_STATES.has(from)) {
    return from === to;
  }
  return TRANSITIONS[from].includes(to);
}

export function assertRunStateTransition(from: RunState, to: RunState): void {
  if (!canTransitionRunState(from, to)) {
    throw new DomainInvariantError([
      {
        code: "OUT_OF_RANGE",
        path: "runState",
        message: `transition ${from} -> ${to} is not allowed`,
      },
    ]);
  }
}

function walkNumbers(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issues.push({ code: "NOT_FINITE", path, message: "number must be finite" });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkNumbers(item, `${path}[${index}]`, issues));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walkNumbers(child, path ? `${path}.${key}` : key, issues);
    }
  }
}

function range(
  value: number,
  min: number,
  max: number,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value < min || value > max) {
    issues.push({
      code: "OUT_OF_RANGE",
      path,
      message: `expected ${min} <= value <= ${max}, got ${value}`,
    });
  }
}

function nonNegative(value: number, path: string, issues: ValidationIssue[]): void {
  if (value < 0) {
    issues.push({ code: "NEGATIVE_VALUE", path, message: "value must not be negative" });
  }
}

export function validateState(state: GameState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  walkNumbers(state, "", issues);

  if (!Number.isInteger(state.monthIndex) || state.monthIndex < 0) {
    issues.push({ code: "INVALID_CLOCK", path: "monthIndex", message: "must be a non-negative integer" });
  }
  if (!Number.isInteger(state.tickSequence) || state.tickSequence < 0) {
    issues.push({ code: "INVALID_CLOCK", path: "tickSequence", message: "must be a non-negative integer" });
  }
  if (state.monthIndex !== state.tickSequence) {
    issues.push({
      code: "INVALID_CLOCK",
      path: "tickSequence",
      message: "tickSequence and monthIndex must advance together",
    });
  }
  if (state.clock.gameClock.stepIndex !== state.monthIndex) {
    issues.push({
      code: "INVALID_CLOCK",
      path: "clock.gameClock.stepIndex",
      message: "stepIndex must equal monthIndex",
    });
  }
  range(state.clock.gameClock.calendarMonth, 1, 12, "clock.gameClock.calendarMonth", issues);
  if (state.clock.config.simulationStep !== "month") {
    issues.push({
      code: "INVALID_CLOCK",
      path: "clock.config.simulationStep",
      message: "MVP simulationStep must be month",
    });
  }
  if (!Number.isInteger(state.clock.config.policyCycleSteps) || state.clock.config.policyCycleSteps < 1) {
    issues.push({
      code: "INVALID_CLOCK",
      path: "clock.config.policyCycleSteps",
      message: "must be a positive integer",
    });
  }

  const { indices, rates, stocks, sentiment, institutions } = state.economy;
  for (const [key, value] of Object.entries(indices)) {
    if (key !== "fx") nonNegative(value, `economy.indices.${key}`, issues);
  }
  range(indices.fx, 20, 500, "economy.indices.fx", issues);
  if (indices.realGdp <= 0) {
    issues.push({ code: "OUT_OF_RANGE", path: "economy.indices.realGdp", message: "must be > 0" });
  }
  if (indices.potentialGdp <= 0) {
    issues.push({ code: "OUT_OF_RANGE", path: "economy.indices.potentialGdp", message: "must be > 0" });
  }
  range(rates.unemployment, 0.02, 0.30, "economy.rates.unemployment", issues);
  range(rates.policyRate, -0.02, 0.30, "economy.rates.policyRate", issues);

  for (const [key, value] of Object.entries(stocks)) {
    nonNegative(value, `economy.stocks.${key}`, issues);
  }
  for (const [key, value] of Object.entries(sentiment)) {
    range(value, 0, 100, `economy.sentiment.${key}`, issues);
  }
  for (const [key, value] of Object.entries(institutions)) {
    range(value, 0, 100, `economy.institutions.${key}`, issues);
  }
  range(state.resources.politicalCapital, 0, 100, "resources.politicalCapital", issues);
  range(
    state.resources.implementationCapacity,
    0,
    100,
    "resources.implementationCapacity",
    issues,
  );
  nonNegative(state.resources.foreignReserves, "resources.foreignReserves", issues);
  nonNegative(state.resources.discretionaryBudget, "resources.discretionaryBudget", issues);

  const debtParts = stocks.governmentDebtDomestic + stocks.governmentDebtForeign;
  if (Math.abs(stocks.governmentDebt - debtParts) > 1e-9) {
    issues.push({
      code: "DEBT_COMPONENT_MISMATCH",
      path: "economy.stocks.governmentDebt",
      message: `total debt ${stocks.governmentDebt} differs from components ${debtParts}`,
    });
  }

  const ids = new Map<string, string>();
  for (const bucket of ["active", "reserved", "completed", "cancelled"] as const) {
    for (const policy of state.policies[bucket]) {
      const prior = ids.get(policy.policyId);
      if (prior) {
        issues.push({
          code: "POLICY_ID_DUPLICATE",
          path: `policies.${bucket}`,
          message: `policyId ${policy.policyId} already exists in ${prior}`,
        });
      } else {
        ids.set(policy.policyId, bucket);
      }
    }
  }

  for (const [index, effect] of state.effects.entries()) {
    const expected = effect.totalWeight ?? 1;
    const sum = effect.weights.reduce((total, weight) => total + weight, 0);
    if (effect.weights.some((weight) => weight < 0) || Math.abs(sum - expected) > 1e-10) {
      issues.push({
        code: "EFFECT_WEIGHT_MISMATCH",
        path: `effects[${index}].weights`,
        message: `non-negative weights must sum to ${expected}; got ${sum}`,
      });
    }
  }

  for (let index = 1; index < state.history.entries.length; index += 1) {
    const previous = state.history.entries[index - 1];
    const current = state.history.entries[index];
    if (previous && current && current.monthIndex < previous.monthIndex) {
      issues.push({
        code: "HISTORY_ORDER",
        path: `history.entries[${index}]`,
        message: "history month order must not move backwards",
      });
    }
  }

  for (const [streamId, stream] of Object.entries(state.rng.streams)) {
    if (stream.streamId !== streamId || stream.state.length !== 4 || stream.drawCount < 0) {
      issues.push({
        code: "INVALID_RNG_STATE",
        path: `rng.streams.${streamId}`,
        message: "RNG stream identity/state is invalid",
      });
    }
  }

  return issues;
}

export function assertValidState(state: GameState): void {
  const issues = validateState(state);
  if (issues.length > 0) throw new DomainInvariantError(issues);
}

export interface ReplayIdentity {
  readonly versions: Pick<
    VersionTuple,
    "engineVersion" | "configSchemaVersion" | "calibrationVersion" | "contentVersion" | "rngVersion"
  >;
  readonly configHash: string;
}

export function assertReplayIdentity(expected: ReplayIdentity, actual: ReplayIdentity): void {
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(expected.versions) as (keyof ReplayIdentity["versions"])[]) {
    if (expected.versions[key] !== actual.versions[key]) {
      issues.push({
        code: "VERSION_MISMATCH",
        path: `versions.${key}`,
        message: `expected ${expected.versions[key]}, got ${actual.versions[key]}`,
      });
    }
  }
  if (expected.configHash !== actual.configHash) {
    issues.push({
      code: "VERSION_MISMATCH",
      path: "configHash",
      message: "replay configHash mismatch makes the run non-reproducible",
    });
  }
  if (issues.length > 0) throw new DomainInvariantError(issues);
}
