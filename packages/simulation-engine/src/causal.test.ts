import { describe, expect, it } from "vitest";
import { createContributionBuilder, selectTopContributions } from "./causal";

const policy = (sourceId: string, labelKey = sourceId) => ({
  sourceType: "policy" as const,
  sourceId,
  labelKey,
  confidence: "high" as const,
});

describe("causal contribution builder", () => {
  it("reconciles positive and negative contributions", () => {
    const result = createContributionBuilder("realGdp", 100)
      .add(policy("stimulus"), 4)
      .add(policy("tax"), -1.5)
      .build();
    expect(result.afterValue).toBe(102.5);
    expect(
      result.contributions.reduce((sum, item) => sum + item.delta, 0),
    ).toBeCloseTo(2.5, 12);
  });

  it("records clamps and display-only rounding", () => {
    const result = createContributionBuilder("policyTrust", 95)
      .add(policy("credibility"), 10)
      .clamp(0, 100)
      .recordDisplayRounding(100)
      .build();
    expect(result.afterValue).toBe(100);
    expect(result.contributions).toContainEqual(
      expect.objectContaining({ sourceId: "stability-clamp", delta: -5 }),
    );
    expect(result.diagnostics.map((item) => item.kind)).toEqual([
      "clamp",
      "rounding",
    ]);
  });

  it("keeps residual mismatch explicit", () => {
    const result = createContributionBuilder("fx", 100)
      .add(policy("rate"), -0.75)
      .build(99.2);
    expect(result.contributions).toContainEqual(
      expect.objectContaining({
        sourceId: "reconciliation-residual",
        delta: -0.05,
      }),
    );
    expect(result.diagnostics[0]?.kind).toBe("residual");
  });

  it("handles zero delta", () => {
    const result = createContributionBuilder("support", 50).build(50);
    expect(result.totalDelta).toBe(0);
    expect(result.contributions).toEqual([]);
  });

  it("sorts equal magnitudes deterministically", () => {
    const result = createContributionBuilder("inflation", 0)
      .add(policy("z"), 1)
      .add({
        sourceType: "event",
        sourceId: "b",
        labelKey: "b",
        confidence: "medium",
      }, -1)
      .add(policy("a"), 1)
      .build(1);

    expect(
      selectTopContributions(result, 3).map(
        (item) => `${item.sourceType}:${item.sourceId}`,
      ),
    ).toEqual(["event:b", "policy:a", "policy:z"]);
  });
});
