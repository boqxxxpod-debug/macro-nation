import { z } from "zod";
import {
  CORE_INDICATOR_DEFINITIONS,
  PRIMARY_INDICATOR_IDS,
  createIndicatorRegistry,
  type IndicatorDefinition,
  type IndicatorSelector,
  type ConfigSnapshot,
  type ParameterDefinition,
} from "@macro-nation/domain";
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

/** Use the saved content snapshot on resume, never the newest downloaded pack. */
export function createSnapshotIndicatorRegistry(
  snapshot: ConfigSnapshot,
  selectors: Readonly<Record<string, IndicatorSelector>> = {},
) {
  const content = contentSchema.parse(snapshot.normalizedConfig.content);
  const definitions = [
    ...CORE_INDICATOR_DEFINITIONS,
    ...(content.indicatorDefinitions ?? []),
  ] as IndicatorDefinition[];
  const registry = createIndicatorRegistry(definitions, selectors);
  const listed = new Set(content.indicators);
  if (
    listed.size !== content.indicators.length ||
    registry.definitions.some(
      (definition) => !listed.has(definition.indicatorId),
    ) ||
    listed.size !== registry.definitions.length
  ) {
    throw new Error(
      "Snapshot indicator catalog does not match content indicator IDs",
    );
  }
  return registry;
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

export function parseConfigPack(
  input: ConfigPackInput,
  indicatorSelectors: Readonly<Record<string, IndicatorSelector>> = {},
): ParsedConfigPack {
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
  unique(pack.content.indicatorDefinitions?.map((item) => item.indicatorId) ?? [], "indicator definition");
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
  const coreIds = new Set<string>(PRIMARY_INDICATOR_IDS);
  for (const definition of pack.content.indicatorDefinitions ?? []) {
    if (coreIds.has(definition.indicatorId)) {
      throw new Error(
        `Core indicator cannot be redefined: ${definition.indicatorId}`,
      );
    }
    if (!indicatorSet.has(definition.indicatorId)) {
      throw new Error(
        `Unlisted indicator definition ${definition.indicatorId}`,
      );
    }
    if (!pack.content.textKeys.includes(definition.labelKey)) {
      throw new Error(`Missing indicator label ${definition.labelKey}`);
    }
  }
  const indicatorRegistry = createIndicatorRegistry(
    [
      ...CORE_INDICATOR_DEFINITIONS,
      ...(pack.content.indicatorDefinitions ?? []),
    ] as IndicatorDefinition[],
    indicatorSelectors,
  );
  const definedIds = new Set(
    indicatorRegistry.definitions.map((item) => item.indicatorId),
  );
  for (const id of pack.content.indicators) {
    if (!definedIds.has(id))
      throw new Error(`Missing indicator definition ${id}`);
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
  const ruleIds = new Set(pack.policyRules.map((rule) => rule.policyId));
  for (const policyId of policySet) {
    if (!ruleIds.has(policyId)) throw new Error(`Missing policy rule ${policyId}`);
  }
  for (const rule of pack.policyRules) {
    if (!policySet.has(rule.policyId)) throw new Error(`Unknown policy ${rule.policyId}`);
    for (const input of rule.inputs ?? []) {
      if (!pack.content.textKeys.includes(input.labelKey)) {
        throw new Error(`Missing policy input label ${input.labelKey}`);
      }
    }
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

  const requiredHashFiles = [
    "coefficients.json",
    "lagKernels.json",
    "shockModel.json",
    "policyRules.json",
    "calibrationTargets.json",
    "sources.json",
    "content.json",
    "balanced-v0.1.0.json",
    "limits-v1.json",
    "effect-curves-v1.json",
    "standard-nation-v1.json",
    "scn01-v1.json",
  ] as const;
  for (const fileName of requiredHashFiles) {
    if (!(fileName in pack.manifest.fileHashes)) {
      throw new Error(`Manifest is missing hash for ${fileName}`);
    }
  }

  const definitions = new Map(pack.coefficients.map((item) => [item.parameterId, item]));
  for (const parameterId of pack.manifest.overrideAllowlist) {
    if (!definitions.has(parameterId)) {
      throw new Error(`Override allowlist references unknown parameter ${parameterId}`);
    }
  }
  const allowedOverrides = new Set(pack.manifest.overrideAllowlist);
  for (const override of pack.scenario.parameterOverrides) {
    if (!allowedOverrides.has(override.parameterId)) {
      throw new Error(`scenario override not allowed: ${override.parameterId}`);
    }
    const definition = definitions.get(override.parameterId);
    if (!definition) throw new Error(`Unknown scenario override parameter ${override.parameterId}`);
    if (override.value < definition.min || override.value > definition.max) {
      throw new Error(`scenario override out of range: ${override.parameterId}`);
    }
  }

  const gdpShareIds = [
    "GDP-SHARE-C-001",
    "GDP-SHARE-I-001",
    "GDP-SHARE-G-001",
    "GDP-SHARE-X-001",
    "GDP-SHARE-M-001",
  ] as const;
  const gdpShares = gdpShareIds.map((id) => definitions.get(id)?.default);
  if (gdpShares.some((value) => value === undefined)) {
    throw new Error("GDP share parameters are incomplete");
  }
  const [cShare, iShare, gShare, xShare, mShare] = gdpShares as [number, number, number, number, number];
  if (Math.abs(cShare + iShare + gShare + xShare - mShare - 1) > 1e-10) {
    throw new Error("GDP shares must satisfy C + I + G + X - M = 1");
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
