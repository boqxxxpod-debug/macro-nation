import { ordinaryNews, projectFacts } from "@macro-nation/advisor-core";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import { historyReferenceDisplay } from "./history";
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
export type StructureStatus = "quiet" | "steady" | "busy" | "peak";
export type StructureKind =
  | "house"
  | "apartment"
  | "office"
  | "tower"
  | "workshop"
  | "factory"
  | "plant"
  | "depot"
  | "warehouse"
  | "quay"
  | "crane"
  | "terminal"
  | "field"
  | "greenhouse"
  | "hangar"
  | "station"
  | "solar"
  | "turbine"
  | "substation"
  | "pylon";

/** Fixed artwork coordinates; only selection and operating status are derived. */
export interface NationStructure {
  readonly id: string;
  readonly kind: StructureKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly status: StructureStatus;
}

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
  /** Confirmed, slow-moving capacity represented by buildings and facilities. */
  readonly structureStage: VisualStage;
  readonly structureReason: string;
  readonly structures: readonly NationStructure[];
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

interface StageRule {
  readonly thresholds: readonly number[];
  readonly margin: number;
}

interface StructureTransitionRule extends StageRule {
  readonly movingAverageMonths: number;
  readonly growthConfirmationMonths: number;
  readonly declineConfirmationMonths: number;
}

interface StructureSlot {
  readonly id: string;
  readonly kind: StructureKind;
  readonly minStage: VisualStage;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A structure changes only after several confirmed monthly averages. */
export function stableStructureStage(
  values: readonly number[],
  config: StructureTransitionRule,
): VisualStage {
  let stage: VisualStage = 1;
  let pending: VisualStage | null = null;
  let confirmed = 0;
  const window: number[] = [];
  for (const value of values) {
    if (!Number.isFinite(value)) {
      window.length = 0;
      pending = null;
      confirmed = 0;
      continue;
    }
    window.push(value);
    if (window.length > config.movingAverageMonths) window.shift();
    if (window.length < config.movingAverageMonths) continue;
    const average = window.reduce((sum, item) => sum + item, 0) / window.length;
    const target = stableStageFrom(stage, average, config);
    if (target === stage) {
      pending = null;
      confirmed = 0;
      continue;
    }
    if (target === pending) confirmed += 1;
    else {
      pending = target;
      confirmed = 1;
    }
    const required =
      target > stage
        ? config.growthConfirmationMonths
        : config.declineConfirmationMonths;
    if (confirmed >= required) {
      stage = target;
      pending = null;
      confirmed = 0;
    }
  }
  return stage;
}

function stableStageFrom(
  initial: VisualStage,
  value: number,
  config: StageRule,
): VisualStage {
  let stage: number = initial;
  while (stage < 3 && value >= config.thresholds[stage]! + config.margin)
    stage += 1;
  while (stage > 0 && value < config.thresholds[stage - 1]! - config.margin)
    stage -= 1;
  return stage as VisualStage;
}

const STRUCTURE_STATUS = ["quiet", "steady", "busy", "peak"] as const;

function selectStructures(
  id: RegionId,
  stage: VisualStage,
  activity: VisualStage,
): readonly NationStructure[] {
  const slots = rules.structures.slots[id] as readonly StructureSlot[];
  return slots
    .filter((slot) => slot.minStage <= stage)
    .map((slot) => ({
      id: slot.id,
      kind: slot.kind,
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      status: STRUCTURE_STATUS[activity],
    }));
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
        1 + (baseUnemployment - (values.unemployment ?? baseUnemployment)) * 5;
      const trust = (values.policyTrust ?? baseTrust) / (baseTrust || 1);
      return 0.6 * primary + 0.2 * employment + 0.2 * trust;
    }
    if (id === "countryside") {
      const consumption =
        (values.consumption ?? baseConsumption) / (baseConsumption || 1);
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
      const series = values.length ? [...values] : [now];
      if (series.at(-1) !== now) series.push(now);
      // Buildings are based only on confirmed monthly snapshots. A draft
      // policy or a one-month shock may change activity, but never invents a
      // finished building before enough committed results exist.
      const structureStage = stableStructureStage(
        values,
        rules.structures.transition,
      );
      const previousStructureStage = stableStructureStage(
        values.slice(0, -1),
        rules.structures.transition,
      );
      const stage = stableStage(series, rules.stages[id]);
      const structureReason =
        structureStage > previousStructureStage
          ? `${metric.label}の改善が複数月続き、固定区画に施設が増えました。`
          : structureStage < previousStructureStage
            ? `${metric.label}の低調が長く続き、施設の規模を縮小しました。`
            : stage !== structureStage
              ? `今月の${metric.label}は稼働状態に反映し、施設の規模は過去の月次結果を維持しています。`
              : `施設の規模は${metric.label}の確定済み月次履歴を反映しています。`;
      const topCause = latest?.topCauses.find((cause) =>
        CAUSAL_IDS[id].includes(cause.indicatorId),
      );
      return [
        id,
        {
          id,
          label: REGION_LABELS[id],
          stage,
          structureStage,
          structureReason,
          structures: selectStructures(id, structureStage, stage),
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
    overlays:
      state.runState === "failed"
        ? ["危機により運営が終了しました"]
        : crisis
          ? ["危機への対応が必要です"]
          : [],
    eventMarkers: [
      ...state.events.activeEventIds.map((id) => {
        const title = historyReferenceDisplay(id, state);
        return title === "過去の記録" ? "イベントが起きています" : title;
      }),
      ...(crisis
        ? [
            state.runState === "failed"
              ? "危機により運営が終了しました"
              : "危機への対応を待っています",
          ]
        : []),
    ],
    news: ordinaryNews(projectFacts(state), state.versions.contentVersion),
  };
}
