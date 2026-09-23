import { describe, expect, it } from "vitest";
import type { GameState } from "./state";
import {
  CORE_INDICATOR_DEFINITIONS,
  createIndicatorRegistry,
} from "./indicators";

const state = {
  economy: { indices: { realGdp: 103 }, rates: { unemployment: 0.06 } },
} as unknown as GameState;

describe("indicator catalog", () => {
  it("reads a built-in and a newly registered state indicator without changing the saved state", () => {
    const registry = createIndicatorRegistry([
      CORE_INDICATOR_DEFINITIONS[0]!,
      {
        indicatorId: "youthUnemployment",
        labelKey: "indicator.youthUnemployment",
        unit: "PercentRate",
        source: { kind: "statePath", path: "economy.rates.unemployment" },
      },
    ]);
    expect(registry.read(state, "realGdp")).toBe(103);
    expect(registry.read(state, "youthUnemployment")).toBe(0.06);
    expect(state.economy.indices.realGdp).toBe(103);
  });

  it("requires an installed pure selector for a computed indicator", () => {
    const definition = {
      indicatorId: "gdpTwice",
      labelKey: "indicator.gdpTwice",
      unit: "IndexLevel" as const,
      source: { kind: "selector" as const, selectorId: "gdpTwice" },
    };
    expect(() => createIndicatorRegistry([definition])).toThrow(
      /Unsupported indicator selector/,
    );
    const registry = createIndicatorRegistry([definition], {
      gdpTwice: (s) => s.economy.indices.realGdp * 2,
    });
    expect(registry.read(state, "gdpTwice")).toBe(206);
  });

  it("fails closed on duplicate IDs, unsafe paths, missing values and non-finite results", () => {
    const realGdp = CORE_INDICATOR_DEFINITIONS[0]!;
    expect(() => createIndicatorRegistry([realGdp, realGdp])).toThrow(
      /Duplicate/,
    );
    expect(() =>
      createIndicatorRegistry([
        {
          ...realGdp,
          source: { kind: "statePath", path: "economy.indices.__proto__" },
        },
      ]),
    ).toThrow(/Invalid indicator state path/);
    const registry = createIndicatorRegistry([realGdp]);
    expect(() =>
      registry.read(
        { economy: { indices: {} } } as unknown as GameState,
        "realGdp",
      ),
    ).toThrow(/Missing indicator state path/);
    expect(() =>
      registry.read(
        { economy: { indices: { realGdp: Infinity } } } as unknown as GameState,
        "realGdp",
      ),
    ).toThrow(/Non-finite indicator/);
    expect(() => registry.read(state, "unknown")).toThrow(/Unknown indicator/);
  });
});
