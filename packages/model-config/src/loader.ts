import type { ConfigSnapshot } from "@macro-nation/domain";

import {
  configPackSchema,
  type ConfigManifest,
  type ConfigPack,
} from "./schemas";

export class ConfigValidationError extends Error {
  readonly details: readonly string[];

  constructor(details: readonly string[]) {
    super(details.join("; "));
    this.name = "ConfigValidationError";
    this.details = details;
  }
}

function uniqueIds(values: readonly string[], label: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function assertPositiveDefinite(matrix: readonly (readonly number[])[]): boolean {
  const size = matrix.length;
  const l = Array.from({ length: size }, () => Array<number>(size).fill(0));
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i]?.[j] ?? 0;
      for (let k = 0; k < j; k += 1) {
        sum -= (l[i]?.[k] ?? 0) * (l[j]?.[k] ?? 0);
      }
      if (i === j) {
        if (sum <= 1e-12) return false;
        const row = l[i];
        if (row) row[j] = Math.sqrt(sum);
      } else {
        const diagonal = l[j]?.[j] ?? 0;
        if (diagonal === 0) return false;
        const row = l[i];
        if (row) row[j] = sum / diagonal;
      }
    }
  }
  return true;
}

function compareVersion(left: string, right: string): number {
  const parse = (version: string) =>
    version
      .replace(/^v/, "")
      .split(".")
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function validateConfigPack(input: unknown, currentEngineVersion = "1.0.0"): ConfigPack {
  const parsed = configPackSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  const pack = parsed.data;
  const errors: string[] = [];

  if (
    compareVersion(currentEngineVersion, pack.manifest.engineCompatibility.min) < 0 ||
    compareVersion(currentEngineVersion, pack.manifest.engineCompatibility.maxExclusive) >= 0
  ) {
    errors.push(
      `engine ${currentEngineVersion} is outside compatible range [${pack.manifest.engineCompatibility.min}, ${pack.manifest.engineCompatibility.maxExclusive})`,
    );
  }
  if (pack.coefficients.modelVersion !== pack.manifest.modelVersion) {
    errors.push("manifest modelVersion does not match coefficients");
  }
  if (pack.content.contentVersion !== pack.manifest.contentVersion) {
    errors.push("manifest contentVersion does not match content");
  }

  const parameterIds = pack.coefficients.parameters.map((parameter) => parameter.parameterId);
  const sourceIds = pack.sources.sources.map((source) => source.id);
  const kernelIds = pack.lagKernels.kernels.map((kernel) => kernel.id);
  const policyIds = pack.policyRules.rules.map((rule) => rule.id);
  const nationIds = pack.nations.map((nation) => nation.nationId);
  const scenarioIds = pack.scenarios.map((scenario) => scenario.id);
  const indicatorIds = pack.content.indicators.map((indicator) => indicator.id);

  uniqueIds(parameterIds, "parameterId", errors);
  uniqueIds(sourceIds, "sourceId", errors);
  uniqueIds(kernelIds, "lagKernelId", errors);
  uniqueIds(policyIds, "policyRuleId", errors);
  uniqueIds(nationIds, "nationId", errors);
  uniqueIds(scenarioIds, "scenarioId", errors);
  uniqueIds(indicatorIds, "indicatorId", errors);

  const parameterSet = new Set(parameterIds);
  const sourceSet = new Set(sourceIds);
  const kernelSet = new Set(kernelIds);
  const policySet = new Set(policyIds);
  const nationSet = new Set(nationIds);
  const indicatorSet = new Set(indicatorIds);
  const referencedSources = new Set<string>();

  for (const parameter of pack.coefficients.parameters) {
    for (const sourceId of parameter.sourceIds) {
      referencedSources.add(sourceId);
      if (!sourceSet.has(sourceId)) errors.push(`parameter ${parameter.parameterId} references missing source ${sourceId}`);
    }
  }
  for (const target of pack.calibrationTargets.targets) {
    for (const sourceId of target.sourceIds) {
      referencedSources.add(sourceId);
      if (!sourceSet.has(sourceId)) errors.push(`target ${target.id} references missing source ${sourceId}`);
    }
  }
  for (const sourceId of sourceIds) {
    if (!referencedSources.has(sourceId)) errors.push(`orphan sourceId: ${sourceId}`);
  }

  for (const kernel of pack.lagKernels.kernels) {
    if (!(kernel.start <= kernel.peak && kernel.peak <= kernel.end)) {
      errors.push(`lag kernel ${kernel.id} must satisfy start <= peak <= end`);
    }
    if (kernel.weights.length !== kernel.end - kernel.start + 1) {
      errors.push(`lag kernel ${kernel.id} weight count must cover start..end`);
    }
    const sum = kernel.weights.reduce((total, weight) => total + weight, 0);
    if (Math.abs(sum - 1) > 1e-10) errors.push(`lag kernel ${kernel.id} weights must sum to 1`);
  }

  for (const rule of pack.policyRules.rules) {
    for (const parameterId of rule.parameterIds) {
      if (!parameterSet.has(parameterId)) errors.push(`policy rule ${rule.id} references missing parameter ${parameterId}`);
    }
    for (const kernelId of rule.lagKernelIds) {
      if (!kernelSet.has(kernelId)) errors.push(`policy rule ${rule.id} references missing lag kernel ${kernelId}`);
    }
  }

  for (const scenario of pack.scenarios) {
    if (!nationSet.has(scenario.nationId)) errors.push(`scenario ${scenario.id} references missing nation ${scenario.nationId}`);
    for (const policyId of scenario.enabledPolicyRuleIds) {
      if (!policySet.has(policyId)) errors.push(`scenario ${scenario.id} references missing policy rule ${policyId}`);
    }
    for (const indicatorId of scenario.indicatorIds) {
      if (!indicatorSet.has(indicatorId)) errors.push(`scenario ${scenario.id} references missing indicator ${indicatorId}`);
    }
  }

  for (const nation of pack.nations) {
    const shareSum = Object.values(nation.industryShares).reduce((total, share) => total + share, 0);
    if (Math.abs(shareSum - 1) > 1e-10) errors.push(`nation ${nation.nationId} industry shares must sum to 1`);
  }

  const matrix = pack.shockModel.correlationMatrix;
  const factorCount = pack.shockModel.factors.length;
  if (matrix.length !== factorCount || matrix.some((row) => row.length !== factorCount)) {
    errors.push("shock correlation matrix dimensions must match factors");
  } else {
    for (let row = 0; row < factorCount; row += 1) {
      if (Math.abs((matrix[row]?.[row] ?? 0) - 1) > 1e-12) {
        errors.push("shock correlation matrix diagonal must equal 1");
        break;
      }
      for (let column = row + 1; column < factorCount; column += 1) {
        if (Math.abs((matrix[row]?.[column] ?? 0) - (matrix[column]?.[row] ?? 0)) > 1e-12) {
          errors.push("shock correlation matrix must be symmetric");
          row = factorCount;
          break;
        }
      }
    }
    if (!errors.some((error) => error.includes("correlation matrix")) && !assertPositiveDefinite(matrix)) {
      errors.push("shock correlation matrix must be positive definite");
    }
  }

  const curveSet = new Set(pack.effectCurves.curveIds);
  for (const kernelId of kernelIds) {
    if (!curveSet.has(kernelId)) errors.push(`lag kernel ${kernelId} is missing from effect curve registry`);
  }

  if (pack.manifest.overrideAllowlist.length === 0) {
    errors.push("overrideAllowlist must not be empty");
  }

  if (errors.length > 0) throw new ConfigValidationError(errors);
  return pack;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyFileHashes(
  manifest: ConfigManifest,
  fileContents: Readonly<Record<string, string>>,
): Promise<void> {
  const errors: string[] = [];
  for (const [path, expectedHash] of Object.entries(manifest.files)) {
    const content = fileContents[path];
    if (content === undefined) {
      errors.push(`manifest file missing: ${path}`);
      continue;
    }
    const actualHash = await sha256Text(content);
    if (actualHash !== expectedHash) errors.push(`hash mismatch: ${path}`);
  }
  if (errors.length > 0) throw new ConfigValidationError(errors);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!key) continue;
    const current = cursor[key];
    if (!current || typeof current !== "object" || Array.isArray(current)) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  const finalKey = parts.at(-1);
  if (finalKey) cursor[finalKey] = cloneJson(value);
}

/**
 * Config layering is explicit: defaults -> calibration profile -> scenario override.
 * Only allowlisted dotted paths may be changed by later layers.
 */
export function mergeConfigLayers(
  defaults: Readonly<Record<string, unknown>>,
  calibrationOverrides: Readonly<Record<string, unknown>>,
  scenarioOverrides: Readonly<Record<string, unknown>>,
  overrideAllowlist: readonly string[],
): Readonly<Record<string, unknown>> {
  const merged = cloneJson(defaults);
  const allowed = new Set(overrideAllowlist);
  for (const layer of [calibrationOverrides, scenarioOverrides]) {
    for (const [path, value] of Object.entries(layer)) {
      if (!allowed.has(path)) {
        throw new ConfigValidationError([`override path is not allowlisted: ${path}`]);
      }
      setPath(merged, path, value);
    }
  }
  return merged;
}

export async function createConfigSnapshot(packInput: unknown): Promise<ConfigSnapshot> {
  const pack = validateConfigPack(packInput);
  const normalized = cloneJson(pack);
  const configHash = await sha256Text(canonicalJson(normalized));
  return {
    configHash,
    sourceManifest: [...pack.manifest.sourceManifest],
    versions: {
      engineVersion: pack.manifest.engineCompatibility.min,
      modelVersion: pack.manifest.modelVersion,
      configSchemaVersion: pack.manifest.configSchemaVersion,
      calibrationVersion: pack.manifest.calibrationVersion,
      contentVersion: pack.manifest.contentVersion,
    },
    payload: normalized as unknown as Readonly<Record<string, unknown>>,
  };
}
