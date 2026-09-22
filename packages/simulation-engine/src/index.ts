import { FOUNDATION_DOMAIN_VERSION } from "@macro-nation/domain";

export * from "./causal";
export * from "./rng";

export const ENGINE_VERSION = "0.1.0" as const;

export interface FoundationProbeInput {
  readonly value: number;
}

export interface FoundationProbeResult {
  readonly domainVersion: typeof FOUNDATION_DOMAIN_VERSION;
  readonly result: number;
}

/** Headless/public API proving that Simulation Engine can execute without Web APIs. */
export function runFoundationProbe(
  input: FoundationProbeInput,
): FoundationProbeResult {
  return {
    domainVersion: FOUNDATION_DOMAIN_VERSION,
    result: input.value + 1,
  };
}
