import { describe, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import {
  createPolicyHandlerRegistry,
  validatePolicyInputs,
} from "./policy-registry";

const rule = {
  policyId: "housing-tax",
  policyType: "housingTax",
  inputs: [
    {
      inputId: "rate",
      labelKey: "policy.housing.rate",
      unit: "PercentRate" as const,
      min: 0,
      max: 0.2,
      defaultValue: 0.05,
      step: 0.01,
    },
    {
      inputId: "exemption",
      labelKey: "policy.housing.exemption",
      unit: "StockLevel" as const,
      min: 0,
      max: 100,
      defaultValue: 20,
    },
  ],
};
const state = { configSnapshot: { configHash: "a".repeat(64) } } as GameState;

describe("policy extension contract", () => {
  it("validates all named inputs before invoking one registered handler for preview or commit", () => {
    const createEffects = vi.fn(() => []);
    const registry = createPolicyHandlerRegistry(
      [rule],
      [{ policyType: "housingTax", createEffects }],
    );
    const values = { rate: 0.05, exemption: 20 };
    expect(registry.createEffects("housing-tax", values, state)).toEqual([]);
    expect(registry.createEffects("housing-tax", values, state)).toEqual([]);
    expect(createEffects).toHaveBeenCalledTimes(2);
    expect(createEffects).toHaveBeenCalledWith({
      rule,
      values,
      state,
      configSnapshot: state.configSnapshot,
    });
    expect(() =>
      registry.createEffects(
        "housing-tax",
        { rate: 0.5, exemption: 20 },
        state,
      ),
    ).toThrow(/Invalid policy input/);
    expect(() =>
      registry.createEffects(
        "housing-tax",
        { rate: 0.05, exemption: 20, secret: 1 },
        state,
      ),
    ).toThrow(/Unknown policy input/);
    expect(createEffects).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown handlers and off-step or missing values; accepts old one-value rules", () => {
    expect(() => createPolicyHandlerRegistry([rule], [])).toThrow(
      /Unsupported policy type/,
    );
    expect(() =>
      validatePolicyInputs(rule, { rate: 0.055, exemption: 20 }),
    ).toThrow(/not on its step/);
    expect(() => validatePolicyInputs(rule, { rate: 0.05 })).toThrow(
      /Invalid policy input exemption/,
    );
    expect(() =>
      validatePolicyInputs(
        {
          policyId: "rate",
          policyType: "interestRate",
          inputMin: -0.02,
          inputMax: 0.3,
        },
        { value: 0.02 },
      ),
    ).not.toThrow();
  });
});
