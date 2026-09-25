import {
  INDUSTRY_IDS,
  flowPerMonth,
  indexLevel,
  percentRate,
  scorePoint,
  share01,
  stockLevel,
  validateState,
  type ConfigSnapshot,
  type EconomyState,
  type GameState,
  type VersionTuple,
} from "@macro-nation/domain";
import { updateDemandAndGdp } from "./demand";
import { updateFiscalIndustries } from "./fiscal-industries";
import { updateFx, updatePricesLabor } from "./macro";
import { RNG_VERSION } from "./rng";
import { createContributionBuilder } from "./causal";
import { ENGINE_VERSION } from "./version";
import {
  XOSHIRO_TICK_RNG_PROVIDER,
  tick,
  type TickDiagnostics,
  type TickMutableStageId,
  type TickStageHandler,
} from "./tick";

export interface NoPolicyRunInput {
  readonly initialState: GameState;
  readonly tickCount: number;
  /** Set false for large seed batches that only need final indicators and failures. */
  readonly collectTrace?: boolean;
}

export interface HeadlessTickRecord {
  /** Month index before the recorded tick. */
  readonly monthIndex: number;
  readonly state: GameState;
  readonly diagnostics: TickDiagnostics;
}

export interface HeadlessFailure {
  readonly kind:
    "precondition" | "invariant" | "contribution" | "tick" | "progress";
  readonly monthIndex: number;
  readonly code: string;
  readonly message: string;
  readonly stage?: string;
  readonly paths?: readonly string[];
}

export interface NoPolicyRunResult {
  readonly strategyId: "no-policy-v1";
  readonly requestedTicks: number;
  readonly ticksCompleted: number;
  readonly finalState: GameState;
  readonly records: readonly HeadlessTickRecord[];
  readonly invariantFailures: readonly HeadlessFailure[];
  readonly failure: HeadlessFailure | null;
}

export interface NoPolicyReplayPackage {
  readonly schemaVersion: "headless-replay-v1";
  readonly strategyId: "no-policy-v1";
  readonly scenarioId: string;
  readonly seed: string;
  readonly tickCount: number;
  readonly engineVersion: string;
  readonly modelVersion: string;
  readonly rngVersion: string;
  readonly configHash: string;
  /** Initial state and its config snapshot make this replay self-contained. */
  readonly initialState: GameState;
  /** The no-policy strategy intentionally has no commands. */
  readonly commands: readonly [];
}

interface ScenarioClock {
  readonly simulationStep: "month";
  readonly policyCycleSteps: number;
  readonly realSecondsPerStep: number;
  readonly offlineMaxSteps: number;
}

interface ScenarioInitialValues {
  readonly realGdp: number;
  readonly cpi: number;
  readonly fx: number;
  readonly unemployment: number;
  readonly policyRate: number;
  readonly governmentDebt: number;
  readonly foreignReserves: number;
  readonly publicInvestment: number;
  readonly policyTrust: number;
  readonly support: number;
}

interface ScenarioNation {
  readonly nationId: string;
  readonly initial: ScenarioInitialValues;
  readonly industryStructure: Readonly<Record<string, number>>;
  readonly tradeStructure: Readonly<Record<string, number>>;
  readonly institutions: Readonly<Record<string, number>>;
  readonly infrastructure: Readonly<Record<string, number>>;
  readonly resources: Readonly<Record<string, number>>;
}

interface ScenarioData {
  readonly id: string;
  readonly nationId: string;
  readonly startYear: number;
  readonly startMonth: number;
  readonly clock: ScenarioClock;
  readonly externalBaseline: Readonly<Record<string, number>>;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Config snapshot is missing ${path}`);
  }
  return value as Record<string, unknown>;
}

function requireNumber(
  source: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Config snapshot value ${key} must be a finite number`);
  }
  return value;
}

function initialScenarioConfig(configSnapshot: ConfigSnapshot): {
  readonly parameters: Readonly<Record<string, number>>;
  readonly nation: ScenarioNation;
  readonly scenario: ScenarioData;
} {
  const normalized = configSnapshot.normalizedConfig;
  const parameters = requireObject(
    normalized.parameters,
    "parameters",
  ) as Record<string, number>;
  const nation = requireObject(
    normalized.nation,
    "nation",
  ) as unknown as ScenarioNation;
  const scenario = requireObject(
    normalized.scenario,
    "scenario",
  ) as unknown as ScenarioData;
  if (scenario.nationId !== nation.nationId) {
    throw new Error(
      `Scenario nation ${scenario.nationId} does not match ${nation.nationId}`,
    );
  }
  return { parameters, nation, scenario };
}

function initialEconomy(
  configSnapshot: ConfigSnapshot,
  nation: ScenarioNation,
  scenario: ScenarioData,
): EconomyState {
  const { parameters } = initialScenarioConfig(configSnapshot);
  const p = (id: string): number => {
    const value = parameters[id];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Config snapshot is missing model parameter ${id}`);
    }
    return value;
  };
  const initial = nation.initial;
  // Current SCN-01 data does not yet define tax/spending bases, external-debt share,
  // or sector-specific import exposure. Keep this bootstrap explicit and neutral:
  // balance the primary budget at government consumption, hold debt domestically,
  // and use the configured aggregate import share for every sector.
  const realGdp = initial.realGdp;
  const cpi = initial.cpi;
  const nominalGdpPerMonth = realGdp * (cpi / 100);
  const annualNominalGdp = nominalGdpPerMonth * 12;
  const marketRate = initial.policyRate;
  const foreignGrowthAnnual = requireNumber(
    scenario.externalBaseline,
    "foreignGrowthAnnual",
  );
  const foreignRateAnnual = requireNumber(
    scenario.externalBaseline,
    "foreignRateAnnual",
  );
  const resourcePriceIndex = requireNumber(
    scenario.externalBaseline,
    "resourcePriceIndex",
  );
  const partnerRelations = requireNumber(
    scenario.externalBaseline,
    "partnerRelations",
  );
  const disasterAlert = requireNumber(
    scenario.externalBaseline,
    "disasterAlert",
  );
  const componentFlows = {
    consumption: realGdp * p("GDP-SHARE-C-001"),
    investment: realGdp * p("GDP-SHARE-I-001"),
    governmentConsumption: realGdp * p("GDP-SHARE-G-001"),
    publicInvestment: initial.publicInvestment,
    exports: realGdp * p("GDP-SHARE-X-001"),
    imports: realGdp * p("GDP-SHARE-M-001"),
  };
  const taxRevenue = componentFlows.governmentConsumption;
  const primarySpending = componentFlows.governmentConsumption;
  const interestPayment = (initial.governmentDebt * marketRate) / 12;
  const industries = Object.fromEntries(
    INDUSTRY_IDS.map((id) => {
      const employmentShare = nation.industryStructure[id];
      if (typeof employmentShare !== "number") {
        throw new Error(`Nation config is missing industry ${id}`);
      }
      return [
        id,
        {
          productionIndex: indexLevel(100),
          employmentShare: share01(employmentShare),
          capacityIndex: indexLevel(100),
          importDependency: share01(nation.tradeStructure.importShare ?? 0),
          priceIndex: indexLevel(cpi),
        },
      ];
    }),
  ) as EconomyState["industries"];

  return {
    indices: {
      realGdp: indexLevel(realGdp),
      cpi: indexLevel(cpi),
      fx: indexLevel(initial.fx),
      nominalWage: indexLevel(cpi),
      realHouseholdIncome: indexLevel(100),
      potentialGdp: indexLevel(realGdp),
      importPrice: indexLevel(cpi * (initial.fx / 100)),
    },
    rates: {
      inflationAnnual: percentRate(p("CORE-INF-001")),
      unemployment: percentRate(initial.unemployment),
      policyRate: percentRate(initial.policyRate),
      marketRate: percentRate(marketRate),
      expectedInflation: percentRate(p("CORE-INF-001")),
      foreignRate: percentRate(foreignRateAnnual),
    },
    ratios: {
      governmentDebtRatio: percentRate(
        annualNominalGdp > 0 ? initial.governmentDebt / annualNominalGdp : 0,
      ),
      fiscalBalanceRatio: percentRate(
        annualNominalGdp > 0
          ? ((taxRevenue - primarySpending - interestPayment) * 12) /
              annualNominalGdp
          : 0,
      ),
    },
    flows: {
      consumption: flowPerMonth(componentFlows.consumption),
      investment: flowPerMonth(componentFlows.investment),
      governmentConsumption: flowPerMonth(componentFlows.governmentConsumption),
      publicInvestment: flowPerMonth(componentFlows.publicInvestment),
      exports: flowPerMonth(componentFlows.exports),
      imports: flowPerMonth(componentFlows.imports),
      taxRevenue: flowPerMonth(taxRevenue),
      primarySpending: flowPerMonth(primarySpending),
      primaryBalance: flowPerMonth(taxRevenue - primarySpending),
      interestPayment: flowPerMonth(interestPayment),
      currentAccount: flowPerMonth(
        componentFlows.exports - componentFlows.imports,
      ),
      capitalFlow: flowPerMonth(0),
      foreignReserveChange: flowPerMonth(0),
    },
    stocks: {
      governmentDebt: stockLevel(initial.governmentDebt),
      domesticGovernmentDebt: stockLevel(initial.governmentDebt),
      externalGovernmentDebt: stockLevel(0),
      foreignReserves: stockLevel(initial.foreignReserves),
      publicCapital: stockLevel(0),
    },
    sentiment: {
      consumerConfidence: scorePoint(50),
      businessConfidence: scorePoint(50),
      policyTrust: scorePoint(initial.policyTrust),
      support: scorePoint(initial.support),
      inequality: scorePoint(50),
      speculationPressure: scorePoint(0),
    },
    institutions: {
      politicalCapital: scorePoint(
        requireNumber(nation.resources, "politicalCapital"),
      ),
      implementationCapacity: scorePoint(
        requireNumber(nation.resources, "implementationCapacity"),
      ),
      centralBankIndependence: scorePoint(
        requireNumber(nation.institutions, "centralBankIndependence"),
      ),
      taxCapacity: scorePoint(
        requireNumber(nation.institutions, "taxCapacity"),
      ),
      procurementTransparency: scorePoint(
        requireNumber(nation.institutions, "procurementTransparency"),
      ),
    },
    industries,
    infrastructure: {
      transport: indexLevel(requireNumber(nation.infrastructure, "transport")),
      energy: indexLevel(requireNumber(nation.infrastructure, "energy")),
      digital: indexLevel(requireNumber(nation.infrastructure, "digital")),
      water: indexLevel(requireNumber(nation.infrastructure, "water")),
      publicFacilities: indexLevel(
        requireNumber(nation.infrastructure, "publicFacilities"),
      ),
    },
    external: {
      foreignGrowthAnnual: percentRate(foreignGrowthAnnual),
      foreignRateAnnual: percentRate(foreignRateAnnual),
      resourcePriceIndex: indexLevel(resourcePriceIndex),
      partnerRelations: scorePoint(partnerRelations),
      disasterAlert: scorePoint(disasterAlert),
      fxShockLogIndex: 0 as EconomyState["external"]["fxShockLogIndex"],
    },
    memory: {
      previousRealGdp: indexLevel(realGdp),
      outputGrowthGapHistory: [],
      previousFxIndex: indexLevel(initial.fx),
      previousResourcePriceIndex: indexLevel(resourcePriceIndex),
      effectiveDebtRateAnnual: percentRate(marketRate),
      baselinePotentialGdp: indexLevel(realGdp),
      publicCapitalFormationHistory: [],
    },
  };
}

/** Build the SCN-01 bootstrap state from its ConfigSnapshot and neutral defaults. */
export function createSCN01InitialState(input: {
  readonly configSnapshot: ConfigSnapshot;
  readonly seed: string;
  readonly versions: VersionTuple;
  readonly slotId?: 1 | 2 | 3;
}): GameState {
  if (!input.seed.trim()) throw new Error("seed must be non-empty");
  if (input.versions.engineVersion !== ENGINE_VERSION) {
    throw new Error(
      `Unsupported engine version ${input.versions.engineVersion}`,
    );
  }
  if (input.versions.rngVersion !== RNG_VERSION) {
    throw new Error(`Unsupported RNG version ${input.versions.rngVersion}`);
  }
  if (
    input.versions.configVersion &&
    input.versions.configVersion !== input.configSnapshot.snapshotVersion
  ) {
    throw new Error(
      "ConfigSnapshot and version tuple configVersion do not match",
    );
  }
  const { nation, scenario } = initialScenarioConfig(input.configSnapshot);
  if (scenario.id !== "SCN-01")
    throw new Error(`Expected SCN-01, got ${scenario.id}`);
  const clock = {
    simulationStep: scenario.clock.simulationStep,
    policyCycleSteps: scenario.clock.policyCycleSteps,
    realSecondsPerStep: scenario.clock.realSecondsPerStep,
    offlineMaxSteps: scenario.clock.offlineMaxSteps,
  };
  const economy = initialEconomy(input.configSnapshot, nation, scenario);
  return {
    gameId: `headless-${input.seed}`,
    slotId: input.slotId ?? 1,
    nationId: nation.nationId,
    scenarioId: "SCN-01",
    difficulty: "standard",
    durationMode: "standard",
    monthIndex: 0,
    tickSequence: 0,
    runState: "running",
    economy,
    policies: { active: [], reserved: [], completed: [], cancelled: [] },
    effects: [],
    events: { activeEventIds: [], cooldownUntilMonth: {} },
    resources: {
      politicalCapital: scorePoint(economy.institutions.politicalCapital),
      implementationCapacity: scorePoint(
        economy.institutions.implementationCapacity,
      ),
      discretionaryBudget: stockLevel(
        requireNumber(nation.resources, "discretionaryBudget"),
      ),
      reservedForeignReserves: stockLevel(0),
    },
    rng: { rootSeed: input.seed, rngVersion: RNG_VERSION, streams: {} },
    crisisCounters: {},
    history: { snapshotMonths: [0] },
    clock: {
      stepIndex: 0,
      year: scenario.startYear,
      month: scenario.startMonth,
      config: clock,
    },
    versions: input.versions,
    configSnapshot: input.configSnapshot,
  };
}

function noPolicyFailure(state: GameState): HeadlessFailure | null {
  const policyCount =
    state.policies.active.length +
    state.policies.reserved.length +
    state.policies.completed.length +
    state.policies.cancelled.length;
  if (policyCount > 0 || state.effects.length > 0) {
    return {
      kind: "precondition",
      monthIndex: state.monthIndex,
      code: "NOT_NO_POLICY_STATE",
      message:
        "The no-policy baseline requires empty policy and scheduled-effect collections",
    };
  }
  if (
    state.events.activeEventIds.length > 0 ||
    state.events.pendingChoiceEventId
  ) {
    return {
      kind: "precondition",
      monthIndex: state.monthIndex,
      code: "NOT_NO_EVENT_STATE",
      message: "The no-policy baseline requires no active or pending events",
    };
  }
  return null;
}

function contributionFailure(
  monthIndex: number,
  diagnostics: TickDiagnostics,
): HeadlessFailure | null {
  for (const entry of diagnostics.causal) {
    const contributed = entry.contributions.reduce(
      (sum, item) => sum + item.delta,
      0,
    );
    const tolerance = Math.max(1e-9, Math.abs(entry.totalDelta) * 1e-8);
    const values = [
      entry.beforeValue,
      entry.afterValue,
      entry.totalDelta,
      contributed,
    ];
    if (
      values.some((value) => !Number.isFinite(value)) ||
      Math.abs(entry.totalDelta - contributed) > tolerance
    ) {
      return {
        kind: "contribution",
        monthIndex,
        code: "CAUSAL_CONTRIBUTION_MISMATCH",
        message: `${entry.indicatorId}: expected ${entry.totalDelta}, contributions total ${contributed}`,
      };
    }
  }
  return null;
}

const NO_POLICY_HANDLERS: Partial<
  Record<TickMutableStageId, TickStageHandler>
> = {
  updateDemand: ({ state, context }) => {
    const output = updateDemandAndGdp({
      economy: state.economy,
      effects: state.effects,
      monthIndex: context.inputMonthIndex,
      configSnapshot: context.configSnapshot,
      rng: state.rng,
      rngProvider: context.rngProvider,
    });
    const currentAccount =
      output.economy.flows.exports - output.economy.flows.imports;
    const currentAccountCausal = createContributionBuilder(
      "currentAccount",
      state.economy.flows.currentAccount,
    )
      .add(
        {
          sourceType: "external",
          sourceId: "net-exports",
          labelKey: "external.netExports",
          confidence: "high",
        },
        currentAccount - state.economy.flows.currentAccount,
      )
      .build(currentAccount);
    return {
      state: {
        ...state,
        economy: {
          ...output.economy,
          flows: {
            ...output.economy.flows,
            currentAccount: flowPerMonth(currentAccount),
          },
        },
        rng: output.rng,
      },
      causal: [...output.causal, currentAccountCausal],
      metrics: {
        outputGap: output.diagnostics.outputGapAfter,
        realGdpMonthlyGrowth: output.diagnostics.realGdpMonthlyGrowth,
      },
    };
  },
  updatePricesLabor: ({ state, context }) => {
    const output = updatePricesLabor({
      economy: state.economy,
      effects: state.effects,
      monthIndex: context.inputMonthIndex,
      configSnapshot: context.configSnapshot,
      rng: state.rng,
      rngProvider: context.rngProvider,
    });
    return {
      state: { ...state, economy: output.economy, rng: output.rng },
      causal: output.causal,
    };
  },
  updateFiscal: ({ state, context }) => {
    const output = updateFiscalIndustries({
      economy: state.economy,
      effects: state.effects,
      monthIndex: context.inputMonthIndex,
      configSnapshot: context.configSnapshot,
    });
    return {
      state: { ...state, economy: output.economy },
      causal: output.causal,
      metrics: { industryAggregateResidual: output.industryAggregateResidual },
    };
  },
  updateFxCapitalReservesTrust: ({ state, context }) => {
    const output = updateFx({
      economy: state.economy,
      effects: state.effects,
      monthIndex: context.inputMonthIndex,
      configSnapshot: context.configSnapshot,
      rng: state.rng,
      rngProvider: context.rngProvider,
    });
    return {
      state: { ...state, economy: output.economy, rng: output.rng },
      causal: output.causal,
    };
  },
};

/** Run SCN-01 without policy commands using the production monthly tick and model blocks. */
export function runNoPolicyHeadless(
  input: NoPolicyRunInput,
): NoPolicyRunResult {
  if (!Number.isInteger(input.tickCount) || input.tickCount <= 0) {
    throw new RangeError("tickCount must be a positive integer");
  }
  const records: HeadlessTickRecord[] = [];
  const invariantFailures: HeadlessFailure[] = [];
  const collectTrace = input.collectTrace ?? true;
  let ticksCompleted = 0;
  let state = input.initialState;
  let failure = noPolicyFailure(state);
  if (failure) {
    return {
      strategyId: "no-policy-v1",
      requestedTicks: input.tickCount,
      ticksCompleted,
      finalState: state,
      records,
      invariantFailures,
      failure,
    };
  }
  const initialIssues = validateState(state);
  if (initialIssues.length > 0) {
    failure = {
      kind: "invariant",
      monthIndex: state.monthIndex,
      code: "INVALID_INITIAL_STATE",
      message: initialIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; "),
      paths: initialIssues.map((issue) => issue.path),
    };
    invariantFailures.push(failure);
    return {
      strategyId: "no-policy-v1",
      requestedTicks: input.tickCount,
      ticksCompleted,
      finalState: state,
      records,
      invariantFailures,
      failure,
    };
  }

  for (let index = 0; index < input.tickCount; index += 1) {
    const monthIndex = state.monthIndex;
    const result = tick({
      state,
      expectedTickSequence: state.tickSequence,
      clockConfig: state.clock.config,
      configSnapshot: state.configSnapshot,
      rngProvider: XOSHIRO_TICK_RNG_PROVIDER,
      handlers: NO_POLICY_HANDLERS,
    });
    if (!result.ok) {
      const invalidState =
        result.error.code === "INVALID_INPUT_STATE" ||
        result.error.code === "INVALID_OUTPUT_STATE";
      failure = {
        kind: invalidState ? "invariant" : "tick",
        monthIndex,
        code: result.error.code,
        message: result.error.message,
        stage: result.error.stage,
      };
      if (invalidState) invariantFailures.push(failure);
      break;
    }

    const nextState = result.value.state;
    const issues = validateState(nextState);
    if (issues.length > 0) {
      failure = {
        kind: "invariant",
        monthIndex,
        code: "INVALID_OUTPUT_STATE",
        message: issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("; "),
        stage: "finalValidation",
        paths: issues.map((issue) => issue.path),
      };
      invariantFailures.push(failure);
      break;
    }
    if (nextState.tickSequence !== state.tickSequence + 1) {
      failure = {
        kind: "progress",
        monthIndex,
        code: "TICK_SEQUENCE_DID_NOT_ADVANCE",
        message: `Expected tickSequence ${state.tickSequence + 1}, got ${nextState.tickSequence}`,
      };
      break;
    }
    const causalError = contributionFailure(
      monthIndex,
      result.value.diagnostics,
    );
    if (causalError) {
      failure = causalError;
      break;
    }

    state = nextState;
    ticksCompleted += 1;
    if (collectTrace) {
      records.push({
        monthIndex,
        state,
        diagnostics: result.value.diagnostics,
      });
    }
  }

  return {
    strategyId: "no-policy-v1",
    requestedTicks: input.tickCount,
    ticksCompleted,
    finalState: state,
    records,
    invariantFailures,
    failure,
  };
}

export function createNoPolicyReplayPackage(
  initialState: GameState,
  tickCount: number,
): NoPolicyReplayPackage {
  if (!Number.isInteger(tickCount) || tickCount <= 0) {
    throw new RangeError("tickCount must be a positive integer");
  }
  return {
    schemaVersion: "headless-replay-v1",
    strategyId: "no-policy-v1",
    scenarioId: initialState.scenarioId,
    seed: initialState.rng.rootSeed,
    tickCount,
    engineVersion: initialState.versions.engineVersion,
    modelVersion: initialState.versions.modelVersion,
    rngVersion: initialState.versions.rngVersion,
    configHash: initialState.configSnapshot.configHash,
    initialState,
    commands: [],
  };
}

/** Re-run a serialized no-policy replay package, rejecting version drift explicitly. */
export function replayNoPolicyPackage(
  replay: NoPolicyReplayPackage,
): NoPolicyRunResult {
  if (
    replay.schemaVersion !== "headless-replay-v1" ||
    replay.strategyId !== "no-policy-v1"
  ) {
    throw new Error("Unsupported replay package format or strategy");
  }
  if (replay.engineVersion !== ENGINE_VERSION) {
    throw new Error(
      `Replay engine ${replay.engineVersion} does not match ${ENGINE_VERSION}`,
    );
  }
  if (replay.rngVersion !== RNG_VERSION) {
    throw new Error(
      `Replay RNG ${replay.rngVersion} does not match ${RNG_VERSION}`,
    );
  }
  if (replay.scenarioId !== replay.initialState.scenarioId) {
    throw new Error("Replay scenario does not match initial state");
  }
  if (replay.seed !== replay.initialState.rng.rootSeed) {
    throw new Error("Replay seed does not match initial RNG state");
  }
  if (replay.configHash !== replay.initialState.configSnapshot.configHash) {
    throw new Error("Replay config hash does not match initial state");
  }
  if (
    replay.engineVersion !== replay.initialState.versions.engineVersion ||
    replay.modelVersion !== replay.initialState.versions.modelVersion ||
    replay.rngVersion !== replay.initialState.versions.rngVersion
  ) {
    throw new Error("Replay version tuple does not match initial state");
  }
  return runNoPolicyHeadless({
    initialState: replay.initialState,
    tickCount: replay.tickCount,
  });
}
