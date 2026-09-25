export interface SourceManifestEntry {
  readonly sourceId: string;
  readonly title: string;
  readonly retrievedAt: string;
  readonly confidence: "high" | "medium" | "low";
  /** Public or repository URL for the evidence record. */
  readonly url?: string;
  /** How the cited source was adapted into this parameter pack. */
  readonly transformation?: string;
  readonly note?: string;
}

export interface VersionTuple {
  readonly saveSchemaVersion: string;
  readonly engineVersion: string;
  readonly configSchemaVersion: string;
  readonly modelVersion: string;
  readonly calibrationVersion: string;
  readonly contentVersion: string;
  readonly rngVersion: string;
  readonly configVersion?: string;
}

export interface ConfigIdentity {
  readonly configHash: string;
  readonly sourceManifest: readonly SourceManifestEntry[];
}

export class ReproducibilityError extends Error {
  readonly code = "REPRODUCIBILITY_MISMATCH" as const;
  constructor(message: string) {
    super(message);
    this.name = "ReproducibilityError";
  }
}

export function assertReproducibleConfig(expected: ConfigIdentity, actual: ConfigIdentity): void {
  if (expected.configHash !== actual.configHash) {
    throw new ReproducibilityError(
      `Config hash mismatch: expected ${expected.configHash}, got ${actual.configHash}`,
    );
  }
  if (JSON.stringify(expected.sourceManifest) !== JSON.stringify(actual.sourceManifest)) {
    throw new ReproducibilityError("Config source manifest mismatch");
  }
}
