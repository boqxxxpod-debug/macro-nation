import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
  sha256Hex,
  stableStringify,
} from "@macro-nation/model-config";
import {
  ENGINE_VERSION,
  createNoPolicyReplayPackage,
  createSCN01InitialState,
  replayNoPolicyPackage,
  runNoPolicyHeadless,
  type HeadlessFailure,
  type NoPolicyReplayPackage,
  type NoPolicyRunResult,
} from "@macro-nation/simulation-engine";
import type {
  GameState,
  PrimaryIndicatorId,
  VersionTuple,
} from "@macro-nation/domain";

interface RunnerOptions {
  readonly ticks: number;
  readonly runs: number;
  readonly seed: string;
  readonly outputDirectory: string;
  readonly replayFile?: string;
}

interface RunRow {
  readonly seed: string;
  readonly requestedTicks: number;
  readonly ticksCompleted: number;
  readonly failure: NoPolicyRunResult["failure"];
  readonly finalIndicators: Readonly<Record<PrimaryIndicatorId, number>>;
  readonly finalStateSha256: string;
}

interface CrisisStopRecord {
  readonly seed: string;
  readonly monthIndex: number;
  readonly configHash: string;
  readonly replayFile: "replay-package.json" | null;
  readonly reproduceCommand: string;
}

const INDICATORS: readonly PrimaryIndicatorId[] = [
  "realGdp",
  "inflation",
  "unemployment",
  "policyRate",
  "fx",
  "governmentDebtRatio",
  "fiscalBalanceRatio",
  "policyTrust",
  "support",
];

function parsePositiveInteger(
  value: string,
  name: string,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function parseArguments(args: readonly string[]): RunnerOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--help" || key === "-h") {
      process.stdout.write(
        "Usage: npm run simulate -- [--ticks 48|96|240|360] [--runs 1..1000] [--seed value] [--out directory] [--replay file]\n",
      );
      process.exit(0);
    }
    if (!key?.startsWith("--"))
      throw new Error(`Unexpected argument ${key ?? ""}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${key}`);
    values.set(key, value);
    index += 1;
  }
  for (const key of values.keys()) {
    if (!["--ticks", "--runs", "--seed", "--out", "--replay"].includes(key)) {
      throw new Error(`Unknown option ${key}`);
    }
  }
  const ticks = parsePositiveInteger(
    values.get("--ticks") ?? "48",
    "--ticks",
    360,
  );
  const runs = parsePositiveInteger(
    values.get("--runs") ?? "1",
    "--runs",
    1000,
  );
  const seed = values.get("--seed") ?? "scn01-no-policy";
  if (!seed.trim()) throw new Error("--seed must be non-empty");
  const replayFile = values.get("--replay");
  if (
    replayFile &&
    (values.has("--ticks") || values.has("--runs") || values.has("--seed"))
  ) {
    throw new Error(
      "--replay cannot be combined with --ticks, --runs, or --seed",
    );
  }
  const outputDirectory = resolve(
    values.get("--out") ?? `artifacts/headless/${ticks}x${runs}-${seed}`,
  );
  return {
    ticks,
    runs,
    seed,
    outputDirectory,
    ...(replayFile ? { replayFile } : {}),
  };
}

function createVersions(
  pack: Awaited<ReturnType<typeof loadSCN01ConfigPack>>,
): VersionTuple {
  return {
    saveSchemaVersion: "2",
    engineVersion: ENGINE_VERSION,
    configSchemaVersion: pack.manifest.configSchemaVersion,
    modelVersion: pack.manifest.modelVersion,
    calibrationVersion: pack.manifest.calibrationVersion,
    contentVersion: pack.manifest.contentVersion,
    rngVersion: pack.manifest.rngVersion,
    configVersion: pack.manifest.configVersion,
  };
}

function indicatorValues(
  state: GameState,
): Readonly<Record<PrimaryIndicatorId, number>> {
  return {
    realGdp: state.economy.indices.realGdp,
    inflation: state.economy.rates.inflationAnnual,
    unemployment: state.economy.rates.unemployment,
    policyRate: state.economy.rates.policyRate,
    fx: state.economy.indices.fx,
    governmentDebtRatio: state.economy.ratios.governmentDebtRatio,
    fiscalBalanceRatio: state.economy.ratios.fiscalBalanceRatio,
    policyTrust: state.economy.sentiment.policyTrust,
    support: state.economy.sentiment.support,
  };
}

function stableSha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function makeStrategyCsv(rows: readonly RunRow[]): string {
  const columns = [
    "strategyId",
    "seed",
    "requestedTicks",
    "ticksCompleted",
    "success",
    ...INDICATORS,
    "firstFailureMonthIndex",
    "failureKind",
    "failureCode",
    "finalStateSha256",
  ] as const;
  const lines = [columns.join(",")];
  for (const row of rows) {
    const failure = row.failure;
    const values = [
      "no-policy-v1",
      row.seed,
      row.requestedTicks,
      row.ticksCompleted,
      failure === null,
      ...INDICATORS.map((indicator) => row.finalIndicators[indicator]),
      failure?.monthIndex ?? null,
      failure?.kind ?? null,
      failure?.code ?? null,
      row.finalStateSha256,
    ];
    lines.push(values.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function summarizeFinalIndicators(rows: readonly RunRow[]) {
  const summary: Partial<
    Record<PrimaryIndicatorId, { min: number; max: number; mean: number }>
  > = {};
  for (const indicator of INDICATORS) {
    const values = rows.map((row) => row.finalIndicators[indicator]);
    summary[indicator] = {
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  }
  return summary;
}

function failureRecord(seed: string, failure: HeadlessFailure) {
  return { seed, ...failure };
}

async function runBatch(options: RunnerOptions): Promise<void> {
  const pack = await loadSCN01ConfigPack();
  const configSnapshot = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  const versions = createVersions(pack);
  const rows: RunRow[] = [];
  const failures: ReturnType<typeof failureRecord>[] = [];
  let chosenReplay:
    | {
        readonly replay: NoPolicyReplayPackage;
        readonly firstFailure: NoPolicyRunResult["failure"];
      }
    | undefined;
  for (let index = 0; index < options.runs; index += 1) {
    const seed =
      options.runs === 1
        ? options.seed
        : `${options.seed}-${String(index + 1).padStart(4, "0")}`;
    const initialState = createSCN01InitialState({
      configSnapshot,
      seed,
      versions,
      durationMode:
        options.ticks <= 48
          ? "short"
          : options.ticks <= 96
            ? "standard"
            : options.ticks <= 240
              ? "long"
              : "ultraLong",
    });
    const result = runNoPolicyHeadless({
      initialState,
      tickCount: options.ticks,
      collectTrace: false,
      stopOnCrisis: options.ticks > 96,
    });
    const replay = createNoPolicyReplayPackage(
      initialState,
      options.ticks,
      options.ticks > 96,
    );
    rows.push({
      seed,
      requestedTicks: result.requestedTicks,
      ticksCompleted: result.ticksCompleted,
      failure: result.failure,
      finalIndicators: indicatorValues(result.finalState),
      finalStateSha256: stableSha256(result.finalState),
    });
    if (!chosenReplay || (result.failure && !chosenReplay.firstFailure)) {
      chosenReplay = { replay, firstFailure: result.failure };
    }
    if (result.failure) {
      failures.push(failureRecord(seed, result.failure));
    }
  }
  const successfulRuns = rows.filter((row) => row.failure === null).length;
  const crisisStops: CrisisStopRecord[] = rows
    .filter((row) => row.failure === null && row.ticksCompleted < options.ticks)
    .map((row, index) => ({
      seed: row.seed,
      monthIndex: row.ticksCompleted,
      configHash: configSnapshot.configHash,
      replayFile: index === 0 ? "replay-package.json" : null,
      reproduceCommand: `npm run simulate -- --ticks ${options.ticks} --runs 1 --seed ${row.seed} --out /tmp/macro-nation-reproduce-${row.seed}`,
    }));
  const summary = {
    schemaVersion: 1,
    strategyId: "no-policy-v1",
    scenarioId: "SCN-01",
    requestedTicks: options.ticks,
    requestedRuns: options.runs,
    successfulRuns,
    completedRuns: rows.filter(
      (row) => row.failure === null && row.ticksCompleted === options.ticks,
    ).length,
    crisisStoppedRuns: crisisStops.length,
    crisisStopRate: crisisStops.length / options.runs,
    firstCrisisStop: crisisStops[0] ?? null,
    failedRuns: options.runs - successfulRuns,
    invariantFailureCount: failures.filter(
      (failure) => failure.kind === "invariant",
    ).length,
    contributionFailureCount: failures.filter(
      (failure) => failure.kind === "contribution",
    ).length,
    tickFailureCount: failures.filter((failure) => failure.kind === "tick")
      .length,
    preconditionFailureCount: failures.filter(
      (failure) => failure.kind === "precondition",
    ).length,
    progressFailureCount: failures.filter(
      (failure) => failure.kind === "progress",
    ).length,
    configIdentity: {
      engineVersion: versions.engineVersion,
      modelVersion: versions.modelVersion,
      calibrationVersion: versions.calibrationVersion,
      rngVersion: versions.rngVersion,
      configVersion: versions.configVersion,
      configHash: configSnapshot.configHash,
    },
    finalIndicatorStats: summarizeFinalIndicators(rows),
  };
  await mkdir(options.outputDirectory, { recursive: true });
  await writeFile(
    resolve(options.outputDirectory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(
    resolve(options.outputDirectory, "strategy.csv"),
    makeStrategyCsv(rows),
  );
  await writeFile(
    resolve(options.outputDirectory, "invariant-failures.json"),
    `${JSON.stringify(
      failures.filter((failure) => failure.kind === "invariant"),
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(options.outputDirectory, "run-failures.json"),
    `${JSON.stringify(failures, null, 2)}\n`,
  );
  await writeFile(
    resolve(options.outputDirectory, "crisis-stops.json"),
    `${JSON.stringify(crisisStops, null, 2)}\n`,
  );
  if (!chosenReplay) throw new Error("No replay row was created");
  await writeFile(
    resolve(options.outputDirectory, "replay-package.json"),
    `${JSON.stringify({ replayPackage: chosenReplay.replay, firstFailure: chosenReplay.firstFailure }, null, 2)}\n`,
  );
  process.stdout.write(
    `SCN-01 no-policy: ${successfulRuns}/${options.runs} valid runs (completed or crisis-stopped) within ${options.ticks} ticks; outputs: ${options.outputDirectory}\n`,
  );
  if (successfulRuns !== options.runs) process.exitCode = 1;
}

async function runReplay(options: RunnerOptions): Promise<void> {
  const source = await readFile(resolve(options.replayFile!), "utf8");
  const parsed = JSON.parse(source) as
    { replayPackage?: NoPolicyReplayPackage } | NoPolicyReplayPackage;
  const replay =
    "replayPackage" in parsed && parsed.replayPackage
      ? parsed.replayPackage
      : (parsed as NoPolicyReplayPackage);
  const actualHash = await sha256Hex(
    stableStringify(replay.initialState.configSnapshot.normalizedConfig),
  );
  if (actualHash !== replay.configHash)
    throw new Error("Replay ConfigSnapshot hash verification failed");
  const result = replayNoPolicyPackage(replay);
  const traceSha256 = stableSha256({
    finalState: result.finalState,
    records: result.records,
    failure: result.failure,
  });
  const summary = {
    schemaVersion: 1,
    strategyId: result.strategyId,
    scenarioId: replay.scenarioId,
    seed: replay.seed,
    requestedTicks: result.requestedTicks,
    ticksCompleted: result.ticksCompleted,
    failure: result.failure,
    configHash: replay.configHash,
    traceSha256,
  };
  await mkdir(options.outputDirectory, { recursive: true });
  await writeFile(
    resolve(options.outputDirectory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(
    resolve(options.outputDirectory, "strategy.csv"),
    makeStrategyCsv([
      {
        seed: replay.seed,
        requestedTicks: result.requestedTicks,
        ticksCompleted: result.ticksCompleted,
        failure: result.failure,
        finalIndicators: indicatorValues(result.finalState),
        finalStateSha256: stableSha256(result.finalState),
      },
    ]),
  );
  const failures = result.failure
    ? [failureRecord(replay.seed, result.failure)]
    : [];
  await writeFile(
    resolve(options.outputDirectory, "invariant-failures.json"),
    `${JSON.stringify(
      failures.filter((failure) => failure.kind === "invariant"),
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(options.outputDirectory, "run-failures.json"),
    `${JSON.stringify(failures, null, 2)}\n`,
  );
  await writeFile(
    resolve(options.outputDirectory, "replay-package.json"),
    `${JSON.stringify({ replayPackage: replay, replayedTraceSha256: traceSha256 }, null, 2)}\n`,
  );
  process.stdout.write(
    `Replay ${result.failure ? "failed" : "passed"}: ${result.ticksCompleted}/${result.requestedTicks} ticks; outputs: ${options.outputDirectory}\n`,
  );
  if (result.failure) process.exitCode = 1;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.replayFile) await runReplay(options);
  else await runBatch(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
