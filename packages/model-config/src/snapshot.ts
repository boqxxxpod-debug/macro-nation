import type { ConfigSnapshot, SourceManifestEntry } from "@macro-nation/domain";
import type { ParsedConfigPack } from "./schemas";
import { normalizeParameters, type ParameterOverride } from "./validation";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyConfigPackHashes(
  pack: ParsedConfigPack,
  files: Readonly<Record<string, unknown>>,
): Promise<void> {
  for (const [name, expected] of Object.entries(pack.manifest.fileHashes)) {
    if (!(name in files)) throw new Error(`Missing hashed config file ${name}`);
    const actual = await sha256Hex(stableStringify(files[name]));
    if (actual !== expected) throw new Error(`Config hash mismatch for ${name}`);
  }
}

function parseSemver(value: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) throw new Error(`Invalid semantic version ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

export function assertEngineCompatibility(pack: ParsedConfigPack, engineVersion: string): void {
  if (
    compareSemver(engineVersion, pack.manifest.compatibleEngine.min) < 0 ||
    compareSemver(engineVersion, pack.manifest.compatibleEngine.max) > 0
  ) {
    throw new Error(`Engine ${engineVersion} is incompatible with config pack ${pack.manifest.id}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export async function createConfigSnapshot(
  pack: ParsedConfigPack,
  calibrationOverrides: readonly ParameterOverride[] = [],
): Promise<ConfigSnapshot> {
  const normalizedConfig = deepFreeze({
    parameters: normalizeParameters(pack, calibrationOverrides),
    parameterDefinitions: pack.coefficients,
    lagKernels: pack.lagKernels,
    shockModel: pack.shockModel,
    policyRules: pack.policyRules,
    model: pack.model,
    limits: pack.limits,
    effectCurves: pack.effectCurves,
    nation: pack.nation,
    scenario: pack.scenario,
    content: pack.content,
  });
  const configHash = await sha256Hex(stableStringify(normalizedConfig));
  const sourceManifest: SourceManifestEntry[] = pack.sources.map((source) => ({
    sourceId: source.sourceId,
    title: source.title,
    retrievedAt: source.retrievedAt,
    confidence: source.confidence,
    ...(source.note ? { note: source.note } : {}),
  }));
  return deepFreeze({
    snapshotVersion: pack.manifest.configVersion,
    configHash,
    sourceManifest,
    normalizedConfig,
  });
}
