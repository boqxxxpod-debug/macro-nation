import { FOUNDATION_DOMAIN_VERSION } from "@macro-nation/domain";

export interface FoundationProbeInput {
  readonly value: number;
}

export interface FoundationProbeResult {
  readonly domainVersion: typeof FOUNDATION_DOMAIN_VERSION;
  readonly result: number;
}

/**
 * Minimal headless/public API proving that Simulation Engine can execute without Web APIs.
 * Economic state transitions are intentionally deferred to later Issues.
 */
export function runFoundationProbe(input: FoundationProbeInput): FoundationProbeResult {
  return {
    domainVersion: FOUNDATION_DOMAIN_VERSION,
    result: input.value + 1,
  };
}
