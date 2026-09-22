import { describe, expect, it } from "vitest";
import { runFoundationProbe } from "./index";

describe("Simulation Engine foundation", () => {
  it("runs headlessly and deterministically in Node/Vitest", () => {
    const input = Object.freeze({ value: 41 });
    expect(runFoundationProbe(input)).toEqual({
      domainVersion: "domain-v2",
      result: 42,
    });
    expect(input.value).toBe(41);
  });
});
