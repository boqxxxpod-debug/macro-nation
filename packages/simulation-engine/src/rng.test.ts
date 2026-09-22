import { describe, expect, it } from "vitest";
import {
  createRngBundle,
  deserializeRngBundle,
  drawUint32,
  previewQuantile,
  serializeRngBundle,
} from "./rng";

function values(seed: string, streamId: string, count: number): number[] {
  let bundle = createRngBundle(seed);
  const result: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const draw = drawUint32(bundle, streamId);
    result.push(draw.value);
    bundle = draw.bundle;
  }
  return result;
}

describe("xoshiro128ss deterministic streams", () => {
  it("matches the golden vector", () => {
    expect(values("macro-nation-golden", "external.global", 8)).toEqual([
      829844291,
      828196886,
      1821503142,
      143005144,
      2755048514,
      2300464237,
      1490271552,
      2445295740,
    ]);
  });

  it("supports edge-like seeds and 10k draws", () => {
    expect(values("0", "event.EVT-01", 10_000)).toHaveLength(10_000);
    expect(values("4294967295", "event.EVT-01", 3)).toEqual(
      values("4294967295", "event.EVT-01", 3),
    );
  });

  it("continues after serialize/deserialize", () => {
    let bundle = createRngBundle("resume", ["market"]);
    for (let index = 0; index < 25; index += 1) {
      bundle = drawUint32(bundle, "market").bundle;
    }
    const restored = deserializeRngBundle(serializeRngBundle(bundle));
    expect(drawUint32(restored, "market").value).toBe(
      drawUint32(bundle, "market").value,
    );
  });

  it("keeps streams independent of creation and draw order", () => {
    let left = createRngBundle("streams");
    const firstA = drawUint32(left, "event.A");
    left = drawUint32(firstA.bundle, "event.B").bundle;
    const secondA = drawUint32(left, "event.A");

    const right = createRngBundle("streams", ["event.C", "event.B", "event.A"]);
    const rightFirstA = drawUint32(right, "event.A");
    const rightSecondA = drawUint32(rightFirstA.bundle, "event.A");

    expect([firstA.value, secondA.value]).toEqual([
      rightFirstA.value,
      rightSecondA.value,
    ]);
  });

  it("does not consume live state during preview", () => {
    const bundle = createRngBundle("preview", ["market"]);
    const before = serializeRngBundle(bundle);
    expect(previewQuantile("optimistic")).toBe(0.84);
    expect(previewQuantile("base")).toBe(0.5);
    expect(previewQuantile("pessimistic")).toBe(0.16);
    expect(serializeRngBundle(bundle)).toBe(before);
  });
});
