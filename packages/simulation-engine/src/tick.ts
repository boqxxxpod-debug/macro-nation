import {
  assertReproducibleConfig,
  validateState,
  type CausalContribution,
  type ClockConfig,
  type ConfigSnapshot,
  type GameState,
  type RngBundle,
} from "@macro-nation/domain";
import {
  RNG_VERSION,
  deserializeRngBundle,
  drawFloat01,
  drawUint32,
  serializeRngBundle,
} from "./rng";
import { ENGINE_VERSION } from "./version";

export const TICK_STAGE_ORDER = [
  "validateInput",
  "createContext",
  "activateReservedPolicies",
  "updateExternalEnvironment",
  "collectScheduledEffects",
  "updateDemand",
  "updateOutputSupplyIndustries",
  "updatePricesLabor",
  "updateFiscal",
  "updateFxCapitalReservesTrust",
  "updateHouseholdDistributionSupportPolitics",
  "evaluateEventsCrisisCompletion",
  "reconcileCausalAndFinalizeSnapshot",
  "finalValidation",
] as const;

export type TickStageId = (typeof TICK_STAGE_ORDER)[number];

export const TICK_MUTABLE_STAGE_IDS = [
  "activateReservedPolicies",
  "updateExternalEnvironment",
  "collectScheduledEffects",
  "updateDemand",
  "updateOutputSupplyIndustries",
  "updatePricesLabor",
  "updateFiscal",
  "updateFxCapitalReservesTrust",
  "updateHouseholdDistributionSupportPolitics",
  "evaluateEventsCrisisCompletion",
] as const;

export type TickMutableStageId = (typeof TICK_MUTABLE_STAGE_IDS)[number];

export const TICK_EXTENSION_POINTS = {
  policyCombos: {
    stage: "activateReservedPolicies",
    position: "after",
  },
  longTermStructure: {
    stage: "updateOutputSupplyIndustries",
    position: "after",
  },
  reactions: {
    stage: "updateHouseholdDistributionSupportPolitics",
    position: "after",
  },
  causalFinalization: {
    stage: "reconcileCausalAndFinalizeSnapshot",
    position: "before-clock-commit",
  },
  reactionSnapshot: {
    stage: "reconcileCausalAndFinalizeSnapshot",
    position: "after-causal-finalization-before-clock-commit",
  },
} as const;

export type TickExtensionPoint = keyof typeof TICK_EXTENSION_POINTS;

const EXTENSIONS_BY_STAGE: Readonly<
  Partial<Record<TickStageId, readonly TickExtensionPoint[]>>
> = Object.freeze({
  activateReservedPolicies: ["policyCombos"],
  updateOutputSupplyIndustries: ["longTermStructure"],
  updateHouseholdDistributionSupportPolitics: ["reactions"],
  reconcileCausalAndFinalizeSnapshot: [
    "causalFinalization",
    "reactionSnapshot",
  ],
});

export interface TickRngDraw {
  readonly value: number;
  readonly bundle: RngBundle;
}

export interface TickRngProvider {
  readonly rngVersion: RngBundle["rngVersion"];
  cloneBundle(bundle: RngBundle): RngBundle;
  drawUint32(bundle: RngBundle, streamId: string): TickRngDraw;
  drawFloat01(bundle: RngBundle, streamId: string): TickRngDraw;
}

export const XOSHIRO_TICK_RNG_PROVIDER: TickRngProvider = Object.freeze({
  rngVersion: RNG_VERSION,
  cloneBundle(bundle) {
    return deserializeRngBundle(serializeRngBundle(bundle));
  },
  drawUint32(bundle, streamId) {
    return drawUint32(bundle, streamId);
  },
  drawFloat01(bundle, streamId) {
    return drawFloat01(bundle, streamId);
  },
});

export interface TickStageContext {
  readonly stage: TickStageId;
  readonly inputMonthIndex: number;
  readonly expectedTickSequence: number;
  readonly clockConfig: ClockConfig;
  readonly configSnapshot: ConfigSnapshot;
  readonly rngProvider: TickRngProvider;
}

export interface TickExtensionContext extends TickStageContext {
  readonly extensionPoint: TickExtensionPoint;
}

export interface TickStageResult {
  readonly state: GameState;
  readonly causal?: readonly CausalContribution[];
  readonly notes?: readonly string[];
}

export type TickStageHandler = (input: {
  readonly state: GameState;
  readonly context: TickStageContext;
}) => TickStageResult;

export type TickExtensionHandler = (input: {
  readonly state: GameState;
  readonly context: TickExtensionContext;
}) => TickStageResult;

export interface TickInput {
  readonly state: GameState;
  readonly expectedTickSequence: number;
  readonly clockConfig: ClockConfig;
  readonly configSnapshot: ConfigSnapshot;
  readonly rngProvider: TickRngProvider;
  readonly handlers?: Partial<Record<TickMutableStageId, TickStageHandler>>;
  readonly extensions?: Partial<Record<TickExtensionPoint, TickExtensionHandler>>;
}

export interface TickDiagnostics {
  readonly engineVersion: typeof ENGINE_VERSION;
  readonly stageTrace: readonly TickStageId[];
  readonly extensionTrace: readonly TickExtensionPoint[];
  readonly causal: readonly CausalContribution[];
  readonly notes: readonly string[];
}

export interface TickOutput {
  readonly state: GameState;
  readonly diagnostics: TickDiagnostics;
}

export type TickErrorCode =
  | "STALE_TICK_SEQUENCE"
  | "INVALID_RUN_STATE"
  | "INVALID_INPUT_STATE"
  | "ENGINE_VERSION_MISMATCH"
  | "CONFIG_MISMATCH"
  | "CLOCK_CONFIG_MISMATCH"
  | "RNG_VERSION_MISMATCH"
  | "ENGINE_TICK_FAILED"
  | "INVALID_OUTPUT_STATE";

export interface TickError {
  readonly code: TickErrorCode;
  readonly message: string;
  readonly stage: TickStageId;
}

export type TickResult =
  | { readonly ok: true; readonly value: TickOutput }
  | {
      readonly ok: false;
      readonly error: TickError;
      /** Exact input state reference. A failed tick never exposes a partial draft. */
      readonly state: GameState;
      readonly diagnostics: TickDiagnostics;
    };

class TickAbort extends Error {
  readonly code: TickErrorCode;

  constructor(code: TickErrorCode, message: string) {
    super(message);
    this.name = "TickAbort";
    this.code = code;
  }
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlain(entry)) as T;
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = clonePlain(entry);
    }
    return output as T;
  }
  return value;
}

function clockConfigEquals(left: ClockConfig, right: ClockConfig): boolean {
  return (
    left.simulationStep === right.simulationStep &&
    left.policyCycleSteps === right.policyCycleSteps &&
    left.realSecondsPerStep === right.realSecondsPerStep &&
    left.offlineMaxSteps === right.offlineMaxSteps
  );
}

function validateTickInput(input: TickInput): void {
  if (
    !Number.isInteger(input.expectedTickSequence) ||
    input.expectedTickSequence !== input.state.tickSequence
  ) {
    throw new TickAbort(
      "STALE_TICK_SEQUENCE",
      `Expected tick sequence ${input.expectedTickSequence}, current sequence is ${input.state.tickSequence}`,
    );
  }
  if (input.state.runState !== "running") {
    throw new TickAbort(
      "INVALID_RUN_STATE",
      `tick requires runState=running, got ${input.state.runState}`,
    );
  }
  if (input.state.versions.engineVersion !== ENGINE_VERSION) {
    throw new TickAbort(
      "ENGINE_VERSION_MISMATCH",
      `State engineVersion ${input.state.versions.engineVersion} does not match engine ${ENGINE_VERSION}`,
    );
  }
  if (!clockConfigEquals(input.state.clock.config, input.clockConfig)) {
    throw new TickAbort(
      "CLOCK_CONFIG_MISMATCH",
      "Injected ClockConfig does not match the state snapshot",
    );
  }
  if (
    input.state.rng.rngVersion !== input.rngProvider.rngVersion ||
    input.state.versions.rngVersion !== input.rngProvider.rngVersion
  ) {
    throw new TickAbort(
      "RNG_VERSION_MISMATCH",
      "Injected RNG provider does not match the state RNG version",
    );
  }
  try {
    assertReproducibleConfig(input.state.configSnapshot, input.configSnapshot);
  } catch (error) {
    throw new TickAbort(
      "CONFIG_MISMATCH",
      error instanceof Error ? error.message : "Config snapshot mismatch",
    );
  }
  if (
    input.state.configSnapshot.snapshotVersion !==
    input.configSnapshot.snapshotVersion
  ) {
    throw new TickAbort(
      "CONFIG_MISMATCH",
      "Config snapshot version mismatch",
    );
  }

  const issues = validateState(input.state);
  if (issues.length > 0) {
    throw new TickAbort(
      "INVALID_INPUT_STATE",
      `Input state failed validation: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }
}

function advanceClock(state: GameState, clockConfig: ClockConfig): GameState {
  const nextMonth = state.clock.month === 12 ? 1 : state.clock.month + 1;
  const nextYear =
    state.clock.month === 12 ? state.clock.year + 1 : state.clock.year;
  return {
    ...state,
    monthIndex: state.monthIndex + 1,
    tickSequence: state.tickSequence + 1,
    clock: {
      stepIndex: state.clock.stepIndex + 1,
      year: nextYear,
      month: nextMonth,
      config: clonePlain(clockConfig),
    },
  };
}

function validateTickOutput(
  state: GameState,
  input: TickInput,
): void {
  const issues = validateState(state);
  if (issues.length > 0) {
    throw new TickAbort(
      "INVALID_OUTPUT_STATE",
      `Output state failed validation: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (
    state.tickSequence !== input.expectedTickSequence + 1 ||
    state.monthIndex !== input.state.monthIndex + 1
  ) {
    throw new TickAbort(
      "INVALID_OUTPUT_STATE",
      "Successful tick must advance tickSequence and monthIndex exactly once",
    );
  }
  if (!clockConfigEquals(state.clock.config, input.clockConfig)) {
    throw new TickAbort(
      "INVALID_OUTPUT_STATE",
      "Output ClockConfig diverged from the injected snapshot",
    );
  }
  try {
    assertReproducibleConfig(input.configSnapshot, state.configSnapshot);
  } catch (error) {
    throw new TickAbort(
      "INVALID_OUTPUT_STATE",
      error instanceof Error ? error.message : "Output config snapshot mismatch",
    );
  }
}

function applyResult(
  result: TickStageResult,
  causal: CausalContribution[],
  notes: string[],
): GameState {
  if (!result || !result.state) {
    throw new Error("Tick stage must return a state");
  }
  if (result.causal) causal.push(...result.causal);
  if (result.notes) notes.push(...result.notes);
  return result.state;
}

export function tick(input: TickInput): TickResult {
  const stageTrace: TickStageId[] = [];
  const extensionTrace: TickExtensionPoint[] = [];
  const causal: CausalContribution[] = [];
  const notes: string[] = [];
  let currentStage: TickStageId = "validateInput";

  const diagnostics = (): TickDiagnostics => ({
    engineVersion: ENGINE_VERSION,
    stageTrace: [...stageTrace],
    extensionTrace: [...extensionTrace],
    causal: [...causal],
    notes: [...notes],
  });

  try {
    validateTickInput(input);
    stageTrace.push("validateInput");

    currentStage = "createContext";
    const clockConfig = clonePlain(input.clockConfig);
    const configSnapshot = clonePlain(input.configSnapshot);
    let working = clonePlain(input.state);
    working = {
      ...working,
      rng: input.rngProvider.cloneBundle(working.rng),
      clock: { ...working.clock, config: clockConfig },
      configSnapshot,
    };
    stageTrace.push("createContext");

    const runExtensions = (stage: TickStageId): void => {
      const points = EXTENSIONS_BY_STAGE[stage] ?? [];
      for (const extensionPoint of points) {
        const handler = input.extensions?.[extensionPoint];
        if (!handler) continue;
        const result = handler({
          state: working,
          context: {
            stage,
            extensionPoint,
            inputMonthIndex: input.state.monthIndex,
            expectedTickSequence: input.expectedTickSequence,
            clockConfig,
            configSnapshot,
            rngProvider: input.rngProvider,
          },
        });
        working = applyResult(result, causal, notes);
        extensionTrace.push(extensionPoint);
      }
    };

    for (const stage of TICK_MUTABLE_STAGE_IDS) {
      currentStage = stage;
      const handler = input.handlers?.[stage];
      if (handler) {
        const result = handler({
          state: working,
          context: {
            stage,
            inputMonthIndex: input.state.monthIndex,
            expectedTickSequence: input.expectedTickSequence,
            clockConfig,
            configSnapshot,
            rngProvider: input.rngProvider,
          },
        });
        working = applyResult(result, causal, notes);
      }
      runExtensions(stage);
      stageTrace.push(stage);
    }

    currentStage = "reconcileCausalAndFinalizeSnapshot";
    runExtensions(currentStage);
    working = advanceClock(working, clockConfig);
    stageTrace.push(currentStage);

    currentStage = "finalValidation";
    validateTickOutput(working, input);
    stageTrace.push("finalValidation");

    return {
      ok: true,
      value: {
        state: working,
        diagnostics: diagnostics(),
      },
    };
  } catch (error) {
    const tickError: TickError = {
      code: error instanceof TickAbort ? error.code : "ENGINE_TICK_FAILED",
      message:
        error instanceof Error
          ? error.message
          : `Unknown error during ${currentStage}`,
      stage: currentStage,
    };
    return {
      ok: false,
      error: tickError,
      state: input.state,
      diagnostics: diagnostics(),
    };
  }
}
