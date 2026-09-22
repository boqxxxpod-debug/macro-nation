import type {
  FlowPerMonth,
  IndexLevel,
  LogIndex,
  PercentRate,
  ScorePoint,
  Share01,
  StockLevel,
} from "./numeric";
import type { ConfigIdentity, VersionTuple } from "./version";

export const PRIMARY_INDICATOR_IDS = [
  "realGdp",
  "inflation",
  "unemployment",
  "policyRate",
  "fx",
  "governmentDebtRatio",
  "fiscalBalanceRatio",
  "policyTrust",
  "support",
] as const;
export type IndicatorId = (typeof PRIMARY_INDICATOR_IDS)[number];

export const INDUSTRY_IDS = [
  "agricultureResources",
  "manufacturing",
  "construction",
  "householdServices",
  "financeRealEstate",
  "energyLogistics",
] as const;
export type IndustryId = (typeof INDUSTRY_IDS)[number];

export type InfrastructureId = "transport" | "energy" | "digital" | "water" | "publicFacilities";
export type RunState =
  | "running"
  | "paused"
  | "calculating"
  | "awaitingEvent"
  | "crisisStopped"
  | "completed"
  | "failed";
export type Difficulty = "intro" | "standard" | "expert";
export type ScenarioId = "SCN-01" | "SCN-02" | "SCN-03" | (string & {});
export type DurationMode = "short" | "standard" | "long" | "custom";

export interface ClockConfig {
  readonly simulationStep: "month";
  readonly policyCycleSteps: number;
  readonly realSecondsPerStep: number;
  readonly offlineMaxSteps: number;
}

export const DEFAULT_CLOCK_CONFIG: ClockConfig = Object.freeze({
  simulationStep: "month",
  policyCycleSteps: 3,
  realSecondsPerStep: 300,
  offlineMaxSteps: 24,
});

export interface GameClock {
  readonly stepIndex: number;
  readonly year: number;
  readonly month: number;
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
  readonly foreignRateAnnual: PercentRate;
  readonly resourcePriceIndex: IndexLevel;
  readonly partnerRelations: ScorePoint;
  readonly disasterAlert: ScorePoint;
  readonly fxShockLogIndex: LogIndex;
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
    readonly inflationAnnual: PercentRate;
    readonly unemployment: PercentRate;
    readonly policyRate: PercentRate;
    readonly marketRate: PercentRate;
    readonly expectedInflation: PercentRate;
    readonly foreignRate: PercentRate;
  };
  readonly ratios: {
    readonly governmentDebtRatio: PercentRate;
    readonly fiscalBalanceRatio: PercentRate;
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
    readonly domesticGovernmentDebt: StockLevel;
    readonly externalGovernmentDebt: StockLevel;
    readonly foreignReserves: StockLevel;
  };
  readonly sentiment: {
    readonly consumerConfidence: ScorePoint;
    readonly businessConfidence: ScorePoint;
    readonly policyTrust: ScorePoint;
    readonly support: ScorePoint;
    readonly inequality: ScorePoint;
    readonly speculationPressure: ScorePoint;
  };
  readonly institutions: {
    readonly politicalCapital: ScorePoint;
    readonly implementationCapacity: ScorePoint;
    readonly centralBankIndependence: ScorePoint;
    readonly taxCapacity: ScorePoint;
    readonly procurementTransparency: ScorePoint;
  };
  readonly industries: Readonly<Record<IndustryId, IndustryState>>;
  readonly infrastructure: Readonly<Record<InfrastructureId, IndexLevel>>;
  readonly external: ExternalState;
}

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
  readonly expertId?: string;
}

export interface PolicyBook {
  readonly active: readonly PolicyDecision[];
  readonly reserved: readonly PolicyDecision[];
  readonly completed: readonly PolicyDecision[];
  readonly cancelled: readonly PolicyDecision[];
}

export type EffectTarget = string;
export interface ScheduledEffect {
  readonly effectId: string;
  readonly sourceType: "policy" | "event";
  readonly sourceId: string;
  readonly targetPath: EffectTarget;
  readonly operation: "addDelta" | "addRate" | "multiply";
  readonly startMonth: number;
  readonly endMonth: number;
  readonly curveId: string;
  readonly weights: readonly number[];
  readonly totalWeight: number;
  readonly baseStrength: number;
  readonly modifierIds: readonly string[];
  readonly uncertainty: { readonly low: number; readonly high: number };
  readonly role: "primary" | "sideEffect";
  readonly labelKey: string;
}

export interface EventState {
  readonly activeEventIds: readonly string[];
  readonly pendingChoiceEventId?: string;
  readonly cooldownUntilMonth: Readonly<Record<string, number>>;
}

export interface GovernmentResources {
  readonly politicalCapital: ScorePoint;
  readonly implementationCapacity: ScorePoint;
  readonly discretionaryBudget: StockLevel;
  readonly reservedForeignReserves: StockLevel;
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

export interface HistoryIndex {
  readonly snapshotMonths: readonly number[];
  readonly lastReviewMonth?: number;
}

export interface ConfigSnapshot extends ConfigIdentity {
  readonly snapshotVersion: string;
  readonly normalizedConfig: Readonly<Record<string, unknown>>;
}

export interface NationProfile {
  readonly nationId: string;
  readonly displayNameKey: string;
  readonly population: StockLevel;
  readonly initialEconomy: EconomyState;
  readonly industryStructure: Readonly<Record<IndustryId, Share01>>;
  readonly tradeStructure: Readonly<Record<string, number>>;
  readonly energyStructure: Readonly<Record<string, Share01>>;
  readonly institutions: Readonly<Record<string, number>>;
  readonly infrastructure: Readonly<Record<InfrastructureId, IndexLevel>>;
  readonly resources: Readonly<Record<string, number>>;
  readonly policyConstraints: Readonly<Record<string, unknown>>;
  readonly visualThemeKey: string;
}

export interface GameState {
  readonly gameId: string;
  readonly slotId: 1 | 2 | 3;
  readonly nationId: string;
  readonly scenarioId: ScenarioId;
  readonly difficulty: Difficulty;
  readonly durationMode?: DurationMode;
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
  readonly clock: GameClock;
  readonly versions: VersionTuple;
  readonly configSnapshot: ConfigSnapshot;
}

export type EvidenceClass = "E" | "C" | "G" | "D" | "E/C" | "G/C";
export interface ParameterDefinition {
  readonly parameterId: string;
  readonly description: string;
  readonly unit: import("./numeric").NumericUnit;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly evidenceClass: EvidenceClass;
  readonly sourceIds: readonly string[];
}
