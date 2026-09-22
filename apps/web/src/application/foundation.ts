import { runFoundationProbe } from "@macro-nation/simulation-engine";

export interface FoundationStatus {
  readonly engine: "headless-ready";
  readonly probeResult: number;
}

export function getFoundationStatus(): FoundationStatus {
  const result = runFoundationProbe({ value: 1 });

  return {
    engine: "headless-ready",
    probeResult: result.result,
  };
}
