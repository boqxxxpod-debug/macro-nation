import { ordinaryNews, projectFacts } from "@macro-nation/advisor-core";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import rules from "./nation-view-rules.json";

export const REGION_IDS = [
  "city",
  "industry",
  "countryside",
  "harbor",
  "airport",
  "transport",
  "energy",
] as const;
export type RegionId = (typeof REGION_IDS)[number];
export type VisualStage = 0 | 1 | 2 | 3;

export const REGION_LABELS: Record<RegionId, string> = {
  city: "都市と暮らし",
  industry: "工業地帯",
  countryside: "農村",
  harbor: "港湾",
  airport: "空港",
  transport: "交通網",
  energy: "エネルギー",
};

export interface RegionVisualState {
  readonly id: RegionId;
  readonly label: string;
  readonly stage: VisualStage;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly value: number;
  readonly previous?: number;
  readonly related: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly topCause?: MonthlyReportSnapshot["topCauses"][number];
}

export interface NationViewModel {
  readonly month: number;
  readonly timeOfDay: "day" | "evening" | "night";
  readonly weatherKey: "clear" | "alert";
  readonly regions: Readonly<Record<RegionId, RegionVisualState>>;
  readonly trafficLevel: VisualStage;
  readonly constructionLevel: VisualStage;
  readonly overlays: readonly string[];
  readonly eventMarkers: readonly string[];
  readonly news: { readonly headline: string; readonly explanation: string };
}

/** A stage is reconstructed from report history, so reopening a save needs no drawing data. */
export function stableStage(
  values: readonly number[],
  config: { readonly thresholds: readonly number[]; readonly margin: number },
): VisualStage {
  let stage = 1;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    while (stage < 3 && value >= config.thresholds[stage]! + config.margin)
      stage += 1;
    while (stage > 0 && value < config.thresholds[stage - 1]! - config.margin)
      stage -= 1;
  }
  return stage as VisualStage;
}

function initialNumber(state: GameState, field: string, fallback: number) {
  const nation = state.configSnapshot.normalizedConfig.nation as
    | {
        initial?: Record<string, number>;
        infrastructure?: Record<string, number>;
      }
    | undefined;
  return (
    nation?.initial?.[field] ?? nation?.infrastructure?.[field] ?? fallback
  );
}

function initialTradeShare(
  state: GameState,
  field: "exportShare" | "importShare",
  fallback: number,
) {
  const nation = state.configSnapshot.normalizedConfig.nation as
    { tradeStructure?: Record<string, number> } | undefined;
  return nation?.tradeStructure?.[field] ?? fallback;
}

interface Metric {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly baseline: number;
}

function metrics(state: GameState): Record<RegionId, Metric> {
  const e = state.economy;
  const output = e.indices.realGdp;
  const initialGdp = initialNumber(state, "realGdp", 100);
  const tradeBaseline = initialGdp;
  return {
    city: {
      id: "realGdp",
      label: "実質GDP",
      value: output,
      baseline: initialGdp,
    },
    industry: {
      id: "manufacturing",
      label: "製造業生産指数",
      value: e.industries.manufacturing.productionIndex,
      baseline: 100,
    },
    countryside: {
      id: "agriculture",
      label: "農業生産指数",
      value: e.industries.agricultureResources.productionIndex,
      baseline: 100,
    },
    harbor: {
      id: "exports",
      label: "輸出（月間）",
      value: e.flows.exports,
      baseline: tradeBaseline * initialTradeShare(state, "exportShare", 0.25),
    },
    airport: {
      id: "imports",
      label: "輸入（月間）",
      value: e.flows.imports,
      baseline: tradeBaseline * initialTradeShare(state, "importShare", 0.23),
    },
    transport: {
      id: "transport",
      label: "交通インフラ指数",
      value: e.infrastructure.transport,
      baseline: initialNumber(state, "transport", 100),
    },
    energy: {
      id: "energy",
      label: "エネルギーインフラ指数",
      value: e.infrastructure.energy,
      baseline: initialNumber(state, "energy", 100),
    },
  };
}

const CAUSAL_IDS: Record<RegionId, readonly string[]> = {
  city: ["realGdp", "unemployment", "realHouseholdIncome"],
  industry: ["realGdp", "investment", "manufacturing"],
  countryside: ["realGdp", "realHouseholdIncome", "agriculture"],
  harbor: ["exports", "currentAccount", "fx"],
  airport: ["imports", "currentAccount", "fx"],
  transport: ["publicCapital", "realGdp", "publicInvestment"],
  energy: ["publicCapital", "realGdp", "inflation"],
};

export function selectNationView(state: GameState): NationViewModel {
  const latest = state.history.reports?.at(-1);
  const prior = state.history.reports?.at(-2);
  const current = metrics(state);
  const baseUnemployment = initialNumber(state, "unemployment", 0.05);
  const baseTrust = initialNumber(state, "policyTrust", 60);
  const baseConsumption =
    state.history.reports?.[0]?.values.consumption ??
    state.economy.flows.consumption;
  const nation = state.configSnapshot.normalizedConfig.nation as
    { energyStructure?: Record<string, number> } | undefined;
  const domesticEnergy = nation?.energyStructure?.domestic ?? 0.5;
  const score = (id: RegionId, values: Readonly<Record<string, number>>) => {
    const metric = current[id];
    const primary =
      (values[metric.id] ?? metric.value) / (metric.baseline || 1);
    if (id === "city") {
      const employment =
        1 +
        (baseUnemployment -
          (values.unemployment ?? state.economy.rates.unemployment)) *
          5;
      const trust =
        (values.policyTrust ?? state.economy.sentiment.policyTrust) /
        (baseTrust || 1);
      return 0.6 * primary + 0.2 * employment + 0.2 * trust;
    }
    if (id === "countryside") {
      const consumption =
        (values.consumption ?? state.economy.flows.consumption) /
        (baseConsumption || 1);
      return 0.7 * primary + 0.3 * consumption;
    }
    return primary;
  };
  const regions = Object.fromEntries(
    REGION_IDS.map((id) => {
      const metric = current[id];
      const values = (state.history.reports ?? [])
        .filter((report) => Number.isFinite(report.values[metric.id]))
        .map((report) => score(id, report.values));
      const now = score(id, {
        [metric.id]: metric.value,
        unemployment: state.economy.rates.unemployment,
        policyTrust: state.economy.sentiment.policyTrust,
        consumption: state.economy.flows.consumption,
      });
      const series = values.length ? values : [now];
      if (series.at(-1) !== now) series.push(now);
      const topCause = latest?.topCauses.find((cause) =>
        CAUSAL_IDS[id].includes(cause.indicatorId),
      );
      return [
        id,
        {
          id,
          label: REGION_LABELS[id],
          stage: stableStage(series, rules.stages[id]),
          metricId: metric.id,
          metricLabel: metric.label,
          value: metric.value,
          previous: prior?.values[metric.id],
          related:
            id === "city"
              ? [
                  {
                    label: "失業率",
                    value: `${(state.economy.rates.unemployment * 100).toFixed(1)}%`,
                  },
                  {
                    label: "政策信頼",
                    value: state.economy.sentiment.policyTrust.toFixed(1),
                  },
                ]
              : id === "countryside"
                ? [
                    {
                      label: "家計消費",
                      value: state.economy.flows.consumption.toFixed(1),
                    },
                  ]
                : id === "energy"
                  ? [
                      {
                        label: "国内電源構成",
                        value: `${(domesticEnergy * 100).toFixed(0)}%`,
                      },
                    ]
                  : [],
          topCause,
        },
      ];
    }),
  ) as unknown as Record<RegionId, RegionVisualState>;
  const crisis =
    state.runState === "crisisStopped" || state.runState === "failed";
  return {
    month: state.monthIndex,
    timeOfDay: (["day", "evening", "night"] as const)[state.monthIndex % 3]!,
    weatherKey: state.economy.external.disasterAlert >= 70 ? "alert" : "clear",
    regions,
    trafficLevel: regions.harbor.stage,
    constructionLevel: regions.city.stage,
    overlays: crisis ? ["危機警戒"] : [],
    eventMarkers: [
      ...state.events.activeEventIds,
      ...(crisis ? ["危機停止"] : []),
    ],
    news: ordinaryNews(projectFacts(state)),
  };
}
