import { z } from "zod";
import { PRIMARY_INDICATOR_IDS, type ParameterDefinition } from "@macro-nation/domain";
import {
  calibrationTargetsSchema,
  contentSchema,
  effectCurvesSchema,
  lagKernelSchema,
  limitsSchema,
  manifestSchema,
  modelSchema,
  nationSchema,
  parameterDefinitionSchema,
  policyRuleSchema,
  scenarioSchema,
  shockModelSchema,
  sourceSchema,
  type ConfigPackInput,
  type ParsedConfigPack,
} from "./schemas";

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} ID`);
}

function positiveDefinite(matrix: readonly (readonly number[])[]): boolean {
  const n = matrix.length;
  if (matrix.some((row) => row.length !== n)) return false;
  const lower = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i]![j]!;
      for (let k = 0; k < j; k += 1) sum -= lower[i]![k]! * lower[j]![k]!;
      if (i === j) {
        if (sum <= 0) return false;
        lower[i]![j] = Math.sqrt(sum);
      } else {
        lower[i]![j] = sum / lower[j]![j]!;
      }
    }
  }
  return true;
}

function validateShockModel(pack: ParsedConfigPack): void {
  const { correlation, cholesky, factors } = pack.shockModel;
  const n = factors.length;
  if (
    correlation.length !== n ||
    cholesky.length !== n ||
    correlation.some((row: readonly number[]) => row.length !== n) ||
    cholesky.some((row: readonly number[]) => row.length !== n)
  ) {
    throw new Error("Shock matrices must match factor count");
  }
  for (let i = 0; i < n; i += 1) {
    if (Math.abs(correlation[i]![i]! - 1) > 1e-12) {
      throw new Error("Correlation diagonal must equal 1");
    }
    for (let j = 0; j < n; j += 1) {
      if (Math.abs(correlation[i]![j]! - correlation[j]![i]!) > 1e-12) {
        throw new Error("Correlation matrix must be symmetric");
      }
      if (j > i && Math.abs(cholesky[i]![j]!) > 1e-12) {
        throw new Error("Cholesky matrix must be lower triangular");
      }
    }
  }
  if (!positiveDefinite(correlation)) throw new Error("Correlation matrix must be positive definite");
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let reconstructed = 0;
      for (let k = 0; k < n; k += 1) {
        reconstructed += cholesky[i]![k]! * cholesky[j]![k]!;
      }
      if (Math.abs(reconstructed - correlation[i]![j]!) > 1e-9) {
        throw new Error("Cholesky matrix does not reconstruct correlation");
      }
    }
  }
}

function validateEventCycles(events: readonly { eventId: string; dependsOn: readonly string[] }[]): void {
  const byId = new Map(events.map((event) => [event.eventId, event]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Circular event reference at ${id}`);
    if (visited.has(id)) return;
    const event = byId.get(id);
    if (!event) throw new Error(`Missing event reference ${id}`);
    visiting.add(id);
    event.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  events.forEach((event) => visit(event.eventId));
}

export function parseConfigPack(input: ConfigPackInput): ParsedConfigPack {
  const pack: ParsedConfigPack = {
    manifest: manifestSchema.parse(input.manifest),
    coefficients: z.array(parameterDefinitionSchema).parse(input.coefficients) as ParameterDefinition[],
    lagKernels: z.array(lagKernelSchema).parse(input.lagKernels),
    shockModel: shockModelSchema.parse(input.shockModel),
    policyRules: z.array(policyRuleSchema).parse(input.policyRules),
    calibrationTargets: calibrationTargetsSchema.parse(input.calibrationTargets),
    sources: z.array(sourceSchema).parse(input.sources),
    content: contentSchema.parse(input.content),
    model: modelSchema.parse(input.model),
    limits: limitsSchema.parse(input.limits),
    effectCurves: effectCurvesSchema.parse(input.effectCurves),
    nation: nationSchema.parse(input.nation),
    scenario: scenarioSchema.parse(input.scenario),
  };

  unique(pack.coefficients.map((item) => item.parameterId), "parameter");
  unique(pack.lagKernels.map((item) => item.kernelId), "lag kernel");
  unique(pack.policyRules.map((item) => item.policyId), "policy rule");
  unique(pack.sources.map((item) => item.sourceId), "source");
  unique(pack.content.indicators, "indicator");
  unique(pack.content.policies, "policy");
  unique(pack.content.events.map((item: { eventId: string }) => item.eventId), "event");

  const sourceIds = new Set(pack.sources.map((item) => item.sourceId));
  const referencedSources = new Set<string>();
  for (const coefficient of pack.coefficients) {
    for (const sourceId of coefficient.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        throw new Error(`Missing source ${sourceId} for ${coefficient.parameterId}`);
      }
      referencedSources.add(sourceId);
    }
  }
  for (const sourceId of sourceIds) {
    if (!referencedSources.has(sourceId)) throw new Error(`Orphan source ${sourceId}`);
  }

  const indicatorSet = new Set(pack.content.indicators);
  for (const id of PRIMARY_INDICATOR_IDS) {
    if (!indicatorSet.has(id)) throw new Error(`Missing primary indicator ${id}`);
  }
  for (const target of pack.calibrationTargets.irf) {
    if (!indicatorSet.has(target.indicatorId)) {
      throw new Error(`Unknown calibration indicator ${target.indicatorId}`);
    }
  }
  for (const target of pack.calibrationTargets.tailBands) {
    if (!indicatorSet.has(target.indicatorId)) {
      throw new Error(`Unknown calibration indicator ${target.indicatorId}`);
    }
  }

  const policySet = new Set(pack.content.policies);
  for (const rule of pack.policyRules) {
    if (!policySet.has(rule.policyId)) throw new Error(`Unknown policy ${rule.policyId}`);
  }
  for (const id of pack.scenario.enabledPolicies) {
    if (!policySet.has(id)) throw new Error(`Scenario references missing policy ${id}`);
  }
  const eventSet = new Set(pack.content.events.map((item: { eventId: string }) => item.eventId));
  for (const id of pack.scenario.enabledEvents) {
    if (!eventSet.has(id)) throw new Error(`Scenario references missing event ${id}`);
  }

  if (
    pack.model.configPackId !== pack.manifest.id ||
    pack.model.modelVersion !== pack.manifest.modelVersion
  ) {
    throw new Error("Model metadata does not match manifest");
  }
  if (pack.scenario.nationId !== pack.nation.nationId) {
    throw new Error("Scenario nationId does not match loaded NationProfile");
  }
  for (const [name, range] of Object.entries(pack.limits.hard) as [string, [number, number]][]) {
    if (range[0] > range[1]) throw new Error(`Invalid hard limit ${name}`);
  }
  for (const [name, range] of Object.entries(pack.limits.scenarioUi) as [string, [number, number]][]) {
    if (range[0] > range[1]) throw new Error(`Invalid UI limit ${name}`);
  }
  for (const [name, weights] of Object.entries(pack.effectCurves) as [string, number[]][]) {
    if (Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-10) {
      throw new Error(`Effect curve ${name} must sum to 1`);
    }
  }
  validateEventCycles(pack.content.events);
  validateShockModel(pack);
  return pack;
}

export interface ParameterOverride {
  readonly parameterId: string;
  readonly value: number;
}

export function normalizeParameters(
  pack: ParsedConfigPack,
  calibrationOverrides: readonly ParameterOverride[] = [],
  scenarioOverrides: readonly ParameterOverride[] = pack.scenario.parameterOverrides,
): Readonly<Record<string, number>> {
  const values = Object.fromEntries(pack.coefficients.map((item) => [item.parameterId, item.default]));
  const definitions = new Map(pack.coefficients.map((item) => [item.parameterId, item]));
  const allowed = new Set(pack.manifest.overrideAllowlist);
  const apply = (overrides: readonly ParameterOverride[], layer: string): void => {
    for (const override of overrides) {
      if (!allowed.has(override.parameterId)) {
        throw new Error(`${layer} override not allowed: ${override.parameterId}`);
      }
      const definition = definitions.get(override.parameterId);
      if (!definition) throw new Error(`Unknown override parameter: ${override.parameterId}`);
      if (override.value < definition.min || override.value > definition.max) {
        throw new Error(`${layer} override out of range: ${override.parameterId}`);
      }
      values[override.parameterId] = override.value;
    }
  };
  apply(calibrationOverrides, "calibration");
  apply(scenarioOverrides, "scenario");
  return Object.freeze(values);
}
