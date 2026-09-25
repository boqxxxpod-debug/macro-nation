import { FOUNDATION_DOMAIN_VERSION } from "@macro-nation/domain";

export * from "./causal";
export * from "./headless";
export * from "./demand";
export * from "./macro";
export * from "./policy-registry";
export * from "./policy-effects";
export * from "./commands";
export * from "./preview";
export * from "./fiscal-industries";
export * from "./rng";
export * from "./tick";
export * from "./version";

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
