import type {
  FlowPerMonth,
  IndexLevel,
  LogIndex,
  PercentPoint,
  PercentRate,
  Share01,
  StockLevel,
} from "./units";

export const PRIMARY_INDICATOR_IDS = [
  "realGdp",
  "inflation",
  "unemployment",
  "policyRate",
  "fx",
  "governmentDebt",
  "foreignReserves",
  "policyTrust",
  "support",
] as const;

export type IndicatorId = (typeof PRIMARY_INDICATOR_IDS)[number] | string;

export const INDUSTRY_IDS = [
  "agricultureResources",
  "manufacturing",
  "construction",
  "householdServices",
  "financeRealEstate",
  "energyLogistics",
] as const;

export type IndustryId = (typeof INDUSTRY_IDS)[number];
export type InfrastructureId = string;
export type ScenarioId = "SCN-01" | "SCN-02" | "SCN-03" | string;
export type Difficulty = "intro" | "standard" | "expert";
export type PolicyType =
  | "interestRate"
  | "taxPackage"
  | "publicWorks"
  | "tariff"
  | "fxIntervention";

export type PolicyStatus =
  | "draft"
  | "previewed"
  | "committed"
  | "reserved"
  | "active"
  | "completed"
  | "cancelled"
  | "terminated";

export type RunState =
  | "running"
  | "paused"
  | "calculating"
  | "awaitingEvent"
  | "crisisStopped"
  | "completed"
  | "failed";

export interface VersionTuple {
  readonly saveSchemaVersion: string;
  readonly engineVersion: string;
  readonly modelVersion: string;
  readonly configSchemaVersion: string;
  readonly calibrationVersion: string;
  readonly contentVersion: string;
  readonly rngVersion: string;
  readonly configVersion?: string;
}

export interface ConfigSnapshotIdentity {
  readonly configHash: string;
  readonly sourceManifest: readonly string[];
}

export interface ConfigSnapshot extends ConfigSnapshotIdentity {
  readonly versions: Pick<
    VersionTuple,
    | "engineVersion"
    | "modelVersion"
    | "configSchemaVersion"
    | "calibrationVersion"
    | "contentVersion"
  >;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ClockConfig {
  readonly simulationStep: "month";
  readonly policyCycleSteps: number;
  readonly realSecondsPerStep: number;
  readonly offlineMaxSteps: number;
}

export interface GameClock {
  readonly stepIndex: number;
  readonly calendarYear: number;
  readonly calendarMonth: number;
}

export interface ClockState {
  readonly gameClock: GameClock;
  readonly config: ClockConfig;
}

export interface IndustryState {
  readonly productionIndex: IndexLevel;
  readonly employmentShare: Share01;
  readonly capacityIndex: IndexLevel;
  readonly importDependency: Share01;
  readonly priceIndex: IndexLevel;
}

export interface ExternalState {
  readonly foreignGrowthAnnual: PercentRate;
  readonly foreignRate: PercentRate;
  readonly resourcePriceIndex: IndexLevel;
  readonly partnerRelation: IndexLevel;
  readonly disasterRisk: Share01;
}

export interface EconomyState {
  readonly indices: {
    readonly realGdp: IndexLevel;
    readonly cpi: IndexLevel;
    readonly fx: IndexLevel;
    readonly nominalWage: IndexLevel;
    readonly realHouseholdIncome: IndexLevel;
    readonly potentialGdp: IndexLevel;
    readonly importPrice: IndexLevel;
  };
  readonly rates: {
    readonly unemployment: PercentRate;
    readonly policyRate: PercentRate;
    readonly marketRate: PercentRate;
    readonly expectedInflation: PercentRate;
    readonly foreignRate: PercentRate;
  };
  readonly gaps: {
    /** potential GDP ratio: (realGdp / potentialGdp) - 1 */
    readonly yGap: PercentPoint;
    /** real interest rate minus the neutral real rate */
    readonly rGap: PercentPoint;
    /** unemployment rate minus NAIRU */
    readonly uGap: PercentPoint;
  };
  readonly flows: {
    readonly consumption: FlowPerMonth;
    readonly investment: FlowPerMonth;
    readonly governmentConsumption: FlowPerMonth;
    readonly publicInvestment: FlowPerMonth;
    readonly exports: FlowPerMonth;
    readonly imports: FlowPerMonth;
    readonly taxRevenue: FlowPerMonth;
    readonly primarySpending: FlowPerMonth;
    readonly interestPayment: FlowPerMonth;
    readonly currentAccount: FlowPerMonth;
    readonly capitalFlow: FlowPerMonth;
  };
  readonly stocks: {
    readonly governmentDebt: StockLevel;
    readonly governmentDebtDomestic: StockLevel;
    readonly governmentDebtForeign: StockLevel;
    readonly foreignReserves: StockLevel;
  };
  readonly sentiment: {
    readonly consumerConfidence: IndexLevel;
    readonly businessConfidence: IndexLevel;
    readonly policyTrust: IndexLevel;
    readonly support: IndexLevel;
    readonly inequality: IndexLevel;
    readonly speculationPressure: IndexLevel;
  };
  readonly institutions: {
    readonly politicalCapital: IndexLevel;
    readonly implementationCapacity: IndexLevel;
    readonly centralBankIndependence: IndexLevel;
    readonly taxCapacity: IndexLevel;
    readonly procurementTransparency: IndexLevel;
  };
  readonly industries: Record<IndustryId, IndustryState>;
  readonly infrastructure: Readonly<Record<InfrastructureId, IndexLevel>>;
  readonly external: ExternalState;
  readonly logs: {
    /** FX rises when the domestic currency depreciates. */
    readonly fxLogIndex: LogIndex;
  };
}

export interface NationProfile {
  readonly nationId: string;
  readonly displayNameKey: string;
  readonly initialEconomy: EconomyState;
  readonly population: StockLevel;
  readonly industryStructure: Record<IndustryId, Share01>;
  readonly tradeStructure: Readonly<Record<string, Share01>>;
  readonly energyStructure: Readonly<Record<string, Share01>>;
  readonly institutions: Readonly<Record<string, IndexLevel>>;
  readonly infrastructure: Readonly<Record<string, IndexLevel>>;
  readonly resources: Readonly<Record<string, StockLevel>>;
  readonly policyConstraints: Readonly<Record<string, number>>;
  readonly visualThemeKey: string;
}

export interface PolicyCosts {
  readonly politicalCapital: number;
  readonly implementationCapacity: number;
  readonly foreignReserves: number;
  readonly immediateBudget: number;
}

export interface PolicyDecision {
  readonly policyId: string;
  readonly type: PolicyType;
  readonly decidedMonth: number;
  readonly activationMonth: number;
  readonly endMonth?: number;
  readonly status: PolicyStatus;
  readonly slotQuarter: number;
  readonly costs: PolicyCosts;
  readonly reservationId?: string;
  readonly sourceCommandId: string;
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
}

export interface PolicyBook {
  readonly active: readonly PolicyDecision[];
  readonly reserved: readonly PolicyDecision[];
  readonly completed: readonly PolicyDecision[];
  readonly cancelled: readonly PolicyDecision[];
}

export interface ScheduledEffect {
  readonly effectId: string;
  readonly sourceType: "policy" | "event";
  readonly sourceId: string;
  readonly targetPath: string;
  readonly operation: "addDelta" | "addRate" | "multiply";
  readonly startMonth: number;
  readonly endMonth: number;
  readonly curveId: string;
  readonly weights: readonly number[];
  readonly totalWeight?: number;
  readonly baseStrength: number;
  readonly modifierIds: readonly string[];
  readonly uncertainty: { readonly low: number; readonly high: number };
  readonly role: "primary" | "sideEffect";
  readonly labelKey: string;
}

export interface GovernmentResources {
  readonly politicalCapital: IndexLevel;
  readonly implementationCapacity: IndexLevel;
  readonly foreignReserves: StockLevel;
  readonly discretionaryBudget: FlowPerMonth;
}

export interface RngStreamState {
  readonly streamId: string;
  readonly state: readonly [number, number, number, number];
  readonly drawCount: number;
}

export interface RngBundle {
  readonly rootSeed: string;
  readonly rngVersion: "xoshiro128ss-v1";
  readonly streams: Readonly<Record<string, RngStreamState>>;
}

export interface EventState {
  readonly activeEventIds: readonly string[];
  readonly awaitingEventId?: string;
}

export interface HistoryEntry {
  readonly monthIndex: number;
  readonly snapshotId: string;
}

export interface HistoryIndex {
  readonly entries: readonly HistoryEntry[];
}

export interface GameState {
  readonly gameId: string;
  readonly slotId: 1 | 2 | 3;
  readonly nationId: string;
  readonly scenarioId: ScenarioId;
  readonly difficulty: Difficulty;
  readonly monthIndex: number;
  readonly tickSequence: number;
  readonly runState: RunState;
  readonly economy: EconomyState;
  readonly policies: PolicyBook;
  readonly effects: readonly ScheduledEffect[];
  readonly events: EventState;
  readonly resources: GovernmentResources;
  readonly rng: RngBundle;
  readonly crisisCounters: Readonly<Record<string, number>>;
  readonly history: HistoryIndex;
  readonly clock: ClockState;
  readonly versions: VersionTuple;
  readonly configSnapshot: ConfigSnapshot;
  readonly selectedExpertIds?: readonly string[];
  readonly durationMode?: "short" | "standard" | "long" | "custom";
  readonly reviewMilestones?: readonly number[];
}
