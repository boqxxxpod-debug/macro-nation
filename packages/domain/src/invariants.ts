import type { GameState, PolicyDecision, RunState, ScheduledEffect } from "./state";

export type ValidationIssueCode =
  | "NON_FINITE"
  | "OUT_OF_RANGE"
  | "NEGATIVE_VALUE"
  | "INVALID_CLOCK"
  | "INVALID_VERSION"
  | "DUPLICATE_POLICY_ID"
  | "INVALID_POLICY_INPUT"
  | "INVALID_EFFECT"
  | "DEBT_MISMATCH"
  | "INDUSTRY_EMPLOYMENT_SHARE_MISMATCH"
  | "RNG_INVALID";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

const transitions: Readonly<Record<RunState, readonly RunState[]>> = {
  running: ["running", "paused", "calculating", "awaitingEvent", "crisisStopped", "completed", "failed"],
  paused: ["paused", "running", "calculating", "completed", "failed"],
  calculating: ["running", "paused", "awaitingEvent", "crisisStopped", "completed", "failed"],
  awaitingEvent: ["awaitingEvent", "running", "crisisStopped", "completed", "failed"],
  crisisStopped: ["crisisStopped", "running", "awaitingEvent", "completed", "failed"],
  completed: ["completed"],
  failed: ["failed"],
};

export function canTransitionRunState(from: RunState, to: RunState): boolean {
  return transitions[from].includes(to);
}

export function isTerminalRunState(state: RunState): boolean {
  return state === "completed" || state === "failed";
}

function add(
  issues: ValidationIssue[],
  code: ValidationIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function numberRule(
  issues: ValidationIssue[],
  path: string,
  value: number,
  range?: readonly [number, number],
  nonNegative = false,
): void {
  if (!Number.isFinite(value)) {
    add(issues, "NON_FINITE", path, `${path} must be finite`);
    return;
  }
  if (nonNegative && value < 0) add(issues, "NEGATIVE_VALUE", path, `${path} must be non-negative`);
  if (range && (value < range[0] || value > range[1])) {
    add(issues, "OUT_OF_RANGE", path, `${path} must be in [${range[0]}, ${range[1]}]`);
  }
}

function policyIds(issues: ValidationIssue[], groups: readonly (readonly PolicyDecision[])[]): void {
  const seen = new Set<string>();
  for (const group of groups) {
    for (const policy of group) {
      if (seen.has(policy.policyId)) {
        add(
          issues,
          "DUPLICATE_POLICY_ID",
          `policies.${policy.policyId}`,
          `Policy ID ${policy.policyId} appears in more than one lifecycle group`,
        );
      }
      seen.add(policy.policyId);
      for (const [inputId, value] of Object.entries(policy.inputs ?? {})) {
        if (!Number.isFinite(value)) {
          add(issues, "INVALID_POLICY_INPUT", `policies.${policy.policyId}.inputs.${inputId}`, "Policy inputs must be finite");
        }
      }
    }
  }
}

function effectRule(issues: ValidationIssue[], effect: ScheduledEffect, index: number): void {
  const path = `effects[${index}]`;
  if (
    !Number.isInteger(effect.startMonth) ||
    !Number.isInteger(effect.endMonth) ||
    effect.startMonth < 0 ||
    effect.endMonth < effect.startMonth
  ) {
    add(issues, "INVALID_EFFECT", path, "ScheduledEffect month range is invalid");
  }
  if (effect.weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    add(issues, "INVALID_EFFECT", `${path}.weights`, "weights must be finite and non-negative");
  }
  const weightSum = effect.weights.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(weightSum - effect.totalWeight) > 1e-10) {
    add(issues, "INVALID_EFFECT", `${path}.totalWeight`, "weights do not reconcile to totalWeight");
  }
}

export function validateState(state: GameState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(state.monthIndex) || state.monthIndex < 0) {
    add(issues, "INVALID_CLOCK", "monthIndex", "monthIndex must be a non-negative integer");
  }
  if (!Number.isInteger(state.tickSequence) || state.tickSequence < 0 || state.tickSequence !== state.monthIndex) {
    add(issues, "INVALID_CLOCK", "tickSequence", "tickSequence and monthIndex must advance together");
  }
  if (state.clock.stepIndex !== state.monthIndex || state.clock.month < 1 || state.clock.month > 12) {
    add(issues, "INVALID_CLOCK", "clock", "clock must match monthIndex and use months 1..12");
  }
  if (
    !Number.isInteger(state.clock.config.policyCycleSteps) ||
    state.clock.config.policyCycleSteps <= 0 ||
    !Number.isFinite(state.clock.config.realSecondsPerStep) ||
    state.clock.config.realSecondsPerStep <= 0 ||
    !Number.isInteger(state.clock.config.offlineMaxSteps) ||
    state.clock.config.offlineMaxSteps < 0
  ) {
    add(issues, "INVALID_CLOCK", "clock.config", "ClockConfig is invalid");
  }

  const e = state.economy;
  numberRule(issues, "economy.indices.realGdp", e.indices.realGdp, undefined, true);
  numberRule(issues, "economy.indices.potentialGdp", e.indices.potentialGdp, undefined, true);
  numberRule(issues, "economy.indices.cpi", e.indices.cpi, undefined, true);
  numberRule(issues, "economy.indices.fx", e.indices.fx, [20, 500]);
  numberRule(issues, "economy.rates.unemployment", e.rates.unemployment, [0.02, 0.3]);
  numberRule(issues, "economy.rates.policyRate", e.rates.policyRate, [-0.02, 0.3]);
  numberRule(issues, "economy.rates.marketRate", e.rates.marketRate, [-0.02, 0.3]);
  numberRule(issues, "economy.rates.inflationAnnual", e.rates.inflationAnnual, [-0.1, 0.5]);
  if (e.memory) {
    if (e.memory.previousRealGdp !== undefined) {
      numberRule(issues, "economy.memory.previousRealGdp", e.memory.previousRealGdp, [Number.MIN_VALUE, Number.MAX_VALUE]);
    }
    e.memory.outputGrowthGapHistory?.forEach((value, index) =>
      numberRule(issues, `economy.memory.outputGrowthGapHistory[${index}]`, value),
    );
    if (e.memory.previousFxIndex !== undefined) {
      numberRule(issues, "economy.memory.previousFxIndex", e.memory.previousFxIndex, [Number.MIN_VALUE, Number.MAX_VALUE]);
    }
    if (e.memory.previousResourcePriceIndex !== undefined) {
      numberRule(issues, "economy.memory.previousResourcePriceIndex", e.memory.previousResourcePriceIndex, [Number.MIN_VALUE, Number.MAX_VALUE]);
    }
    if (e.memory.effectiveDebtRateAnnual !== undefined) {
      numberRule(issues, "economy.memory.effectiveDebtRateAnnual", e.memory.effectiveDebtRateAnnual);
    }
    if (e.memory.baselinePotentialGdp !== undefined) {
      numberRule(issues, "economy.memory.baselinePotentialGdp", e.memory.baselinePotentialGdp, [Number.MIN_VALUE, Number.MAX_VALUE]);
    }
    if (e.memory.completedPolicyPotential !== undefined) {
      numberRule(issues, "economy.memory.completedPolicyPotential", e.memory.completedPolicyPotential, undefined, true);
    }
    if (e.memory.appliedPolicyPotential !== undefined) {
      numberRule(issues, "economy.memory.appliedPolicyPotential", e.memory.appliedPolicyPotential, undefined, true);
    }
    e.memory.publicCapitalFormationHistory?.forEach((value, index) =>
      numberRule(issues, `economy.memory.publicCapitalFormationHistory[${index}]`, value, undefined, true),
    );
  }

  for (const [name, value] of Object.entries(e.flows)) numberRule(issues, `economy.flows.${name}`, value);
  for (const [name, value] of Object.entries(e.stocks)) numberRule(issues, `economy.stocks.${name}`, value, undefined, true);

  const parts = e.stocks.domesticGovernmentDebt + e.stocks.externalGovernmentDebt;
  const debtTolerance = Math.max(1e-9, Math.abs(e.stocks.governmentDebt) * 1e-9);
  if (Math.abs(parts - e.stocks.governmentDebt) > debtTolerance) {
    add(issues, "DEBT_MISMATCH", "economy.stocks.governmentDebt", "governmentDebt must equal domestic + external debt");
  }

  const industryEmploymentShare = Object.values(e.industries).reduce(
    (sum, industry) => sum + industry.employmentShare,
    0,
  );
  if (Math.abs(industryEmploymentShare - 1) > 1e-9) {
    add(
      issues,
      "INDUSTRY_EMPLOYMENT_SHARE_MISMATCH",
      "economy.industries",
      "industry employment shares must sum to one",
    );
  }

  const scores: readonly [string, number][] = [
    ["economy.sentiment.consumerConfidence", e.sentiment.consumerConfidence],
    ["economy.sentiment.businessConfidence", e.sentiment.businessConfidence],
    ["economy.sentiment.policyTrust", e.sentiment.policyTrust],
    ["economy.sentiment.support", e.sentiment.support],
    ["economy.sentiment.inequality", e.sentiment.inequality],
    ["economy.sentiment.speculationPressure", e.sentiment.speculationPressure],
    ["economy.institutions.politicalCapital", e.institutions.politicalCapital],
    ["economy.institutions.implementationCapacity", e.institutions.implementationCapacity],
    ["economy.institutions.centralBankIndependence", e.institutions.centralBankIndependence],
    ["economy.institutions.taxCapacity", e.institutions.taxCapacity],
    ["economy.institutions.procurementTransparency", e.institutions.procurementTransparency],
    ["resources.politicalCapital", state.resources.politicalCapital],
    ["resources.implementationCapacity", state.resources.implementationCapacity],
  ];
  for (const [path, value] of scores) numberRule(issues, path, value, [0, 100]);

  for (const [id, industry] of Object.entries(e.industries)) {
    numberRule(issues, `economy.industries.${id}.productionIndex`, industry.productionIndex, undefined, true);
    numberRule(issues, `economy.industries.${id}.capacityIndex`, industry.capacityIndex, undefined, true);
    numberRule(issues, `economy.industries.${id}.priceIndex`, industry.priceIndex, undefined, true);
    numberRule(issues, `economy.industries.${id}.employmentShare`, industry.employmentShare, [0, 1]);
    numberRule(issues, `economy.industries.${id}.importDependency`, industry.importDependency, [0, 1]);
  }

  policyIds(issues, [
    state.policies.active,
    state.policies.reserved,
    state.policies.completed,
    state.policies.cancelled,
  ]);
  if (state.policyAdministration) {
    const admin = state.policyAdministration;
    const commands = new Set<string>();
    const quarters = new Map<number, number>();
    for (const receipt of admin.receipts) {
      if (!receipt.commandId || commands.has(receipt.commandId))
        add(issues, "INVALID_POLICY_INPUT", "policyAdministration.receipts", "Command IDs must be unique and non-empty");
      commands.add(receipt.commandId);
      quarters.set(receipt.quarter, (quarters.get(receipt.quarter) ?? 0) + 1);
    }
    for (const [quarter, count] of quarters) {
      if (!Number.isInteger(quarter) || quarter < 0 || count > 3)
        add(issues, "INVALID_POLICY_INPUT", "policyAdministration.receipts", "At most three actions are allowed per quarter");
    }
    const reservationIds = new Set<string>();
    for (const reservation of admin.reservations) {
      if (!reservation.reservationId || reservationIds.has(reservation.reservationId) ||
          !state.policies.reserved.some((policy) => policy.policyId === reservation.policyId))
        add(issues, "INVALID_POLICY_INPUT", "policyAdministration.reservations", "Reservations must refer to unique reserved policies");
      reservationIds.add(reservation.reservationId);
      for (const [key, value] of Object.entries(reservation.costs))
        numberRule(issues, `policyAdministration.reservations.${reservation.policyId}.${key}`, value, undefined, true);
    }
    if (admin.reservations.length !== state.policies.reserved.length)
      add(issues, "INVALID_POLICY_INPUT", "policyAdministration.reservations", "Every reserved policy needs one reservation");
    const held = admin.reservations.reduce((sum, item) => sum + item.costs.foreignReserves, 0);
    if (Math.abs(held - state.resources.reservedForeignReserves) > 1e-9)
      add(issues, "INVALID_POLICY_INPUT", "resources.reservedForeignReserves", "Held foreign reserves do not match reservations");
  }
  state.effects.forEach((effect, index) => effectRule(issues, effect, index));

  for (const [name, value] of Object.entries(state.versions)) {
    if (typeof value === "string" && value.trim() === "") {
      add(issues, "INVALID_VERSION", `versions.${name}`, `${name} must be non-empty`);
    }
  }
  if (!/^[a-f0-9]{64}$/i.test(state.configSnapshot.configHash)) {
    add(issues, "INVALID_VERSION", "configSnapshot.configHash", "configHash must be SHA-256 hex");
  }

  if (state.rng.rngVersion !== "xoshiro128ss-v1") {
    add(issues, "RNG_INVALID", "rng.rngVersion", "Unsupported RNG version");
  }
  for (const [id, stream] of Object.entries(state.rng.streams)) {
    if (
      stream.streamId !== id ||
      stream.state.length !== 4 ||
      stream.state.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffffffff) ||
      !Number.isInteger(stream.drawCount) ||
      stream.drawCount < 0
    ) {
      add(issues, "RNG_INVALID", `rng.streams.${id}`, "RNG stream state is invalid");
    }
  }
  return issues;
}
