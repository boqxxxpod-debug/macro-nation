import type { NumericUnit } from "./numeric";
import type { GameState, IndicatorId } from "./state";

export interface IndicatorDefinition {
  readonly indicatorId: IndicatorId;
  readonly labelKey: string;
  readonly unit: NumericUnit;
  readonly source:
    | { readonly kind: "statePath"; readonly path: string }
    | { readonly kind: "selector"; readonly selectorId: string };
}

export type IndicatorSelector = (state: GameState) => number;

/** Compatibility catalog for saves/config packs predating indicator metadata. */
export const CORE_INDICATOR_DEFINITIONS: readonly IndicatorDefinition[] =
  Object.freeze([
    {
      indicatorId: "realGdp",
      labelKey: "indicator.realGdp",
      unit: "IndexLevel",
      source: { kind: "statePath", path: "economy.indices.realGdp" },
    },
    {
      indicatorId: "inflation",
      labelKey: "indicator.inflation",
      unit: "PercentRate",
      source: { kind: "statePath", path: "economy.rates.inflationAnnual" },
    },
    {
      indicatorId: "unemployment",
      labelKey: "indicator.unemployment",
      unit: "PercentRate",
      source: { kind: "statePath", path: "economy.rates.unemployment" },
    },
    {
      indicatorId: "policyRate",
      labelKey: "indicator.policyRate",
      unit: "PercentRate",
      source: { kind: "statePath", path: "economy.rates.policyRate" },
    },
    {
      indicatorId: "fx",
      labelKey: "indicator.fx",
      unit: "IndexLevel",
      source: { kind: "statePath", path: "economy.indices.fx" },
    },
    {
      indicatorId: "governmentDebtRatio",
      labelKey: "indicator.governmentDebtRatio",
      unit: "PercentRate",
      source: { kind: "statePath", path: "economy.ratios.governmentDebtRatio" },
    },
    {
      indicatorId: "fiscalBalanceRatio",
      labelKey: "indicator.fiscalBalanceRatio",
      unit: "PercentRate",
      source: { kind: "statePath", path: "economy.ratios.fiscalBalanceRatio" },
    },
    {
      indicatorId: "policyTrust",
      labelKey: "indicator.policyTrust",
      unit: "ScorePoint",
      source: { kind: "statePath", path: "economy.sentiment.policyTrust" },
    },
    {
      indicatorId: "support",
      labelKey: "indicator.support",
      unit: "ScorePoint",
      source: { kind: "statePath", path: "economy.sentiment.support" },
    },
  ]);

const SAFE_ID = /^[a-z][a-zA-Z0-9._-]*$/;
const SAFE_ECONOMY_PATH =
  /^economy\.(?:indices|rates|ratios|flows|stocks|sentiment|institutions|industries|infrastructure|external)(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/;

export function createIndicatorRegistry(
  definitions: readonly IndicatorDefinition[],
  selectors: Readonly<Record<string, IndicatorSelector>> = {},
) {
  const byId = new Map<string, IndicatorDefinition>();
  for (const definition of definitions) {
    const { indicatorId, source } = definition;
    if (!SAFE_ID.test(indicatorId) || byId.has(indicatorId)) {
      throw new Error(`Duplicate or invalid indicator ID ${indicatorId}`);
    }
    if (
      source.kind === "statePath" &&
      (!SAFE_ECONOMY_PATH.test(source.path) ||
        source.path
          .split(".")
          .some((part) =>
            ["constructor", "prototype", "__proto__"].includes(part),
          ))
    ) {
      throw new Error(`Invalid indicator state path ${source.path}`);
    }
    if (
      source.kind === "selector" &&
      (!SAFE_ID.test(source.selectorId) ||
        !Object.hasOwn(selectors, source.selectorId) ||
        typeof selectors[source.selectorId] !== "function")
    ) {
      throw new Error(`Unsupported indicator selector ${source.selectorId}`);
    }
    byId.set(indicatorId, definition);
  }

  return Object.freeze({
    definitions: Object.freeze([...definitions]),
    read(state: GameState, indicatorId: IndicatorId): number {
      const definition = byId.get(indicatorId);
      if (!definition) throw new Error(`Unknown indicator ${indicatorId}`);
      const { source } = definition;
      let value: unknown;
      if (source.kind === "selector") {
        value = selectors[source.selectorId]!(state);
      } else {
        value = state as unknown;
        for (const key of source.path.split(".")) {
          if (
            !value ||
            typeof value !== "object" ||
            !Object.hasOwn(value, key)
          ) {
            throw new Error(`Missing indicator state path ${source.path}`);
          }
          value = (value as Record<string, unknown>)[key];
        }
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Non-finite indicator ${indicatorId}`);
      }
      return value;
    },
  });
}
