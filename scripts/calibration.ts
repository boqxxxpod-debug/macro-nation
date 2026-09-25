import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
  stableStringify,
} from "@macro-nation/model-config";
import {
  ENGINE_VERSION,
  createFixedPolicyReplayPackage,
  createNoPolicyReplayPackage,
  createReservedPolicy,
  createSCN01InitialState,
  runNoPolicyHeadless,
  runPolicyHeadless,
  type HeadlessTickRecord,
} from "@macro-nation/simulation-engine";
import type { GameState, VersionTuple } from "@macro-nation/domain";

const command = process.argv[2];
const options = new Map<string, string>();
for (let i = 3; i < process.argv.length; i += 2) {
  const key = process.argv[i],
    value = process.argv[i + 1];
  if (!key?.startsWith("--") || !value) throw Error(`Invalid option ${key}`);
  options.set(key, value);
}
const out = resolve(options.get("--out") ?? "artifacts/headless/calibration");
const runs = Number(
  options.get("--runs") ?? (command === "moments" ? "1000" : "16"),
);
if (!Number.isInteger(runs) || runs < 1 || runs > 1000)
  throw Error("--runs must be 1..1000");
const seed = options.get("--seed") ?? "scn01-calibration";
const pack = await loadSCN01ConfigPack();
const snapshot = await createConfigSnapshot(
  pack,
  pack.scenario.parameterOverrides,
);
const versions: VersionTuple = {
  saveSchemaVersion: "1",
  engineVersion: ENGINE_VERSION,
  configSchemaVersion: pack.manifest.configSchemaVersion,
  modelVersion: pack.manifest.modelVersion,
  calibrationVersion: pack.manifest.calibrationVersion,
  contentVersion: pack.manifest.contentVersion,
  rngVersion: pack.manifest.rngVersion,
  configVersion: pack.manifest.configVersion,
};
const identity = {
  scenarioId: "SCN-01",
  engineVersion: ENGINE_VERSION,
  modelVersion: versions.modelVersion,
  calibrationVersion: versions.calibrationVersion,
  rngVersion: versions.rngVersion,
  configHash: snapshot.configHash,
  seed,
};
const fresh = (run: number) =>
  createSCN01InitialState({
    configSnapshot: snapshot,
    versions,
    seed: `${seed}-${String(run + 1).padStart(4, "0")}`,
  });
const policies = [
  { id: "interest-rate", value: 0.03 },
  { id: "tax-package", value: 0.01 },
  { id: "public-works", value: 0.01 },
  { id: "tariff", value: 0.1 },
  { id: "fx-intervention", value: 0.01 },
] as const;
const metrics = [
  "realGdp",
  "potentialGdp",
  "cpi",
  "unemployment",
  "fx",
  "importPrice",
  "imports",
  "investment",
  "consumption",
  "taxRevenue",
  "foreignReserves",
  "policyTrust",
] as const;
type Metric = (typeof metrics)[number];
function value(state: GameState, metric: Metric): number {
  const e = state.economy;
  switch (metric) {
    case "realGdp":
    case "potentialGdp":
    case "cpi":
    case "fx":
    case "importPrice":
      return e.indices[metric];
    case "unemployment":
      return e.rates.unemployment;
    case "imports":
    case "investment":
    case "consumption":
    case "taxRevenue":
      return e.flows[metric];
    case "foreignReserves":
      return e.stocks.foreignReserves;
    case "policyTrust":
      return e.sentiment.policyTrust;
  }
}
function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return (
    (s[Math.floor((s.length - 1) / 2)]! + s[Math.floor(s.length / 2)]!) / 2
  );
}
function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function std(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}
function quantile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor((ordered.length - 1) * fraction)]!;
}
function correlation(a: readonly number[], b: readonly number[]): number {
  const x = mean(a),
    y = mean(b);
  const d = Math.sqrt(
    a.reduce((s, v) => s + (v - x) ** 2, 0) *
      b.reduce((s, v) => s + (v - y) ** 2, 0),
  );
  return d === 0 ? 0 : a.reduce((s, v, i) => s + (v - x) * (b[i]! - y), 0) / d;
}
async function save(name: string, data: unknown) {
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, name), JSON.stringify(data, null, 2) + "\n");
}
function assertRun(
  result: ReturnType<typeof runNoPolicyHeadless>,
  replay: unknown,
  run: number,
  shockPath: readonly unknown[] = result.records.map((record) => ({
    monthIndex: record.monthIndex,
    rng: record.state.rng,
  })),
) {
  if (result.failure) {
    return {
      seed: fresh(run).rng.rootSeed,
      monthIndex: result.failure.monthIndex,
      failure: result.failure,
      versions,
      configHash: snapshot.configHash,
      shockPath,
      replay,
      command: `npm run calibration:${command} -- --runs ${runs} --seed ${seed} --out ${out}`,
    };
  }
  return null;
}

async function irf() {
  const paths: Record<string, Record<Metric, number[][]>> = Object.fromEntries(
    policies.map((p) => [
      p.id,
      Object.fromEntries(metrics.map((m) => [m, []])),
    ]),
  ) as unknown as Record<string, Record<Metric, number[][]>>;
  let firstFailure: unknown = null;
  for (let i = 0; i < runs; i++) {
    const state = fresh(i),
      base = runNoPolicyHeadless({ initialState: state, tickCount: 60 });
    if (base.failure) {
      firstFailure = assertRun(base, createNoPolicyReplayPackage(state, 60), i);
      break;
    }
    for (const policy of policies) {
      const variantState = {
        ...state,
        policies: {
          ...state.policies,
          reserved: [
            createReservedPolicy(
              state,
              policy.id,
              policy.value,
              `${policy.id}-${i}`,
            ),
          ],
        },
      };
      const result = runPolicyHeadless({
        initialState: variantState,
        tickCount: 60,
      });
      if (result.failure) {
        firstFailure = assertRun(
          result,
          createFixedPolicyReplayPackage(variantState, 60),
          i,
        );
        break;
      }
      for (let month = 0; month < 60; month++) {
        const a = result.records[month]!.state,
          b = base.records[month]!.state;
        if (
          a.configSnapshot.configHash !== b.configSnapshot.configHash ||
          stableStringify(a.rng) !== stableStringify(b.rng)
        ) {
          firstFailure = {
            seed: state.rng.rootSeed,
            monthIndex: month,
            code: "PAIRING_MISMATCH",
            replay: createFixedPolicyReplayPackage(variantState, 60),
          };
          break;
        }
        for (const metric of metrics) {
          const before = value(b, metric),
            after = value(a, metric);
          paths[policy.id]![metric][i] ??= [];
          paths[policy.id]![metric][i]![month] =
            metric === "unemployment" ||
            metric === "policyTrust" ||
            metric === "foreignReserves" ||
            metric === "taxRevenue" ||
            metric === "imports" ||
            metric === "investment" ||
            metric === "consumption" ||
            metric === "importPrice"
              ? after - before
              : after / before - 1;
        }
      }
      if (firstFailure) break;
    }
    if (firstFailure) break;
  }
  if (firstFailure) {
    await save("irf-first-failure.json", firstFailure);
    throw Error("Paired IRF failed; replay saved");
  }
  const medianPaths = Object.fromEntries(
    policies.map((p) => [
      p.id,
      Object.fromEntries(
        metrics.map((m) => [
          m,
          Array.from({ length: 60 }, (_, i) =>
            median(paths[p.id]![m].map((run) => run[i]!)),
          ),
        ]),
      ),
    ]),
  ) as Record<string, Record<Metric, number[]>>;
  const targetResults = pack.calibrationTargets.irf.map((target) => {
    const policyId =
      target.shockId === "policy-rate-plus-100bp"
        ? "interest-rate"
        : "public-works";
    const observed =
      medianPaths[policyId]![target.indicatorId as Metric]![
        target.horizonMonths - 1
      ]!;
    return {
      targetId: target.targetId,
      policyId,
      month: target.horizonMonths,
      observed,
      min: target.min,
      max: target.max,
      pass: observed >= target.min && observed <= target.max,
    };
  });
  const checks = [
    {
      id: "MON-GDP-PEAK",
      month:
        medianPaths["interest-rate"]!.realGdp.slice(0, 36).indexOf(
          Math.min(...medianPaths["interest-rate"]!.realGdp.slice(0, 36)),
        ) + 1,
      min: 18,
      max: 24,
    },
    {
      id: "MON-U-PEAK",
      month:
        medianPaths["interest-rate"]!.unemployment.slice(0, 36).indexOf(
          Math.max(...medianPaths["interest-rate"]!.unemployment.slice(0, 36)),
        ) + 1,
      min: 15,
      max: 24,
    },
    {
      id: "TAX-GDP-12M",
      observed: medianPaths["tax-package"]!.realGdp[11],
      min: -0.005,
      max: -0.001,
    },
    {
      id: "TRF-PRICE-3M",
      observed: medianPaths.tariff!.importPrice[2]! / (100 * 0.1),
      min: 0.5,
      max: 1,
    },
    { id: "TRF-IMPORT-12M", observed: medianPaths.tariff!.imports[11], max: 0 },
    {
      id: "FXI-FX-6M",
      observed: medianPaths["fx-intervention"]!.fx[5],
      min: -0.015,
      max: -0.002,
    },
    {
      id: "FXI-RESERVES-1M",
      observed: medianPaths["fx-intervention"]!.foreignReserves[0],
      max: 0,
    },
    {
      id: "MON-INVESTMENT-6M",
      observed: medianPaths["interest-rate"]!.investment[5],
      max: 0,
    },
    {
      id: "MON-CPI-36M",
      observed: medianPaths["interest-rate"]!.cpi[35],
      max: 0,
    },
    {
      id: "TAX-REVENUE-12M",
      observed: medianPaths["tax-package"]!.taxRevenue[11],
      min: 0,
    },
    {
      id: "TAX-CONSUMPTION-4M",
      observed: medianPaths["tax-package"]!.consumption[3],
      max: 0,
    },
    {
      id: "TRF-RETALIATION-12M",
      observed: medianPaths.tariff!.policyTrust[11],
      max: 0,
    },
  ].map((x) => ({
    ...x,
    pass:
      "month" in x
        ? x.month! >= x.min! && x.month! <= x.max!
        : x.observed! >= (x.min ?? -Infinity) &&
          x.observed! <= (x.max ?? Infinity),
  }));
  const features = Object.fromEntries(
    policies.map((policy) => {
      const primary: Metric =
        policy.id === "fx-intervention"
          ? "fx"
          : policy.id === "tariff"
            ? "importPrice"
            : "realGdp";
      const series = medianPaths[policy.id]![primary];
      const extremum =
        policy.id === "public-works" || policy.id === "tariff"
          ? Math.max(...series)
          : Math.min(...series);
      const peakMonth = series.indexOf(extremum) + 1;
      return [
        policy.id,
        {
          primaryIndicator: primary,
          peakMonth,
          peakDifference: extremum,
          cumulativeDifference: series.reduce((sum, change) => sum + change, 0),
          reversedBy60Months: series
            .slice(peakMonth)
            .some((change) => change * extremum < 0),
          bookedCosts: createReservedPolicy(
            fresh(0),
            policy.id,
            policy.value,
            `${policy.id}-0`,
          ).costs,
        },
      ];
    }),
  );
  const summary = {
    schemaVersion: 1,
    kind: "paired-irf",
    ...identity,
    runs,
    months: 60,
    targetResults,
    checks,
    features,
    pathsEvery3Months: Object.fromEntries(
      policies.map((p) => [
        p.id,
        Object.fromEntries(
          metrics.map((m) => [
            m,
            medianPaths[p.id]![m].filter((_, i) => (i + 1) % 3 === 0),
          ]),
        ),
      ]),
    ),
  };
  await save("irf.json", summary);
  const failed = [...targetResults, ...checks].find((x) => !x.pass);
  if (failed) {
    const state = fresh(0);
    const policyId =
      "policyId" in failed
        ? failed.policyId
        : failed.id.startsWith("TAX")
          ? "tax-package"
          : failed.id.startsWith("TRF")
            ? "tariff"
            : failed.id.startsWith("FXI")
              ? "fx-intervention"
              : failed.id.startsWith("PINV")
                ? "public-works"
                : "interest-rate";
    const policy = policies.find((p) => p.id === policyId)!;
    const variant = {
      ...state,
      policies: {
        ...state.policies,
        reserved: [
          createReservedPolicy(
            state,
            policy.id,
            policy.value,
            `${policy.id}-0`,
          ),
        ],
      },
    };
    const baseline = runNoPolicyHeadless({
      initialState: state,
      tickCount: 60,
    });
    await save("irf-first-failure.json", {
      failed,
      seed: state.rng.rootSeed,
      monthIndex: "month" in failed ? failed.month - 1 : 0,
      versions,
      configHash: snapshot.configHash,
      shockPath: baseline.records.map((record) => ({
        monthIndex: record.monthIndex,
        rng: record.state.rng,
      })),
      replay: createFixedPolicyReplayPackage(variant, 60),
      command: `npm run calibration:irf -- --runs ${runs} --seed ${seed} --out ${out}`,
    });
    throw Error("IRF band failed; inspect irf.json and irf-first-failure.json");
  }
  console.log(
    `Paired IRF: ${runs} seeds, five policies, all ${targetResults.length + checks.length} gates passed; ${out}/irf.json`,
  );
}
async function moments() {
  const gdpGrowth: number[] = [],
    gaps: number[] = [],
    inflation: number[] = [],
    u: number[] = [],
    fx: number[] = [],
    previousGap: number[] = [],
    nextGap: number[] = [];
  const regime = { slack: 0, normal: 0, boom: 0 };
  let firstFailure: unknown = null;
  for (let i = 0; i < runs; i++) {
    const state = fresh(i);
    const shockPath: unknown[] = [];
    let previous = state.economy.indices.realGdp,
      lastGap: number | undefined;
    const result = runNoPolicyHeadless({
      initialState: state,
      tickCount: 96,
      collectTrace: false,
      onTick(record: HeadlessTickRecord) {
        shockPath.push({
          monthIndex: record.monthIndex,
          rng: record.state.rng,
        });
        const e = record.state.economy;
        const gap = e.indices.realGdp / e.indices.potentialGdp - 1;
        if (record.monthIndex >= 12) {
          gdpGrowth.push(e.indices.realGdp / previous - 1);
          gaps.push(gap);
          inflation.push(e.rates.inflationAnnual);
          u.push(e.rates.unemployment);
          fx.push(e.indices.fx);
          regime[gap < -0.02 ? "slack" : gap > 0.02 ? "boom" : "normal"]++;
          if (lastGap !== undefined) {
            previousGap.push(lastGap);
            nextGap.push(gap);
          }
        }
        previous = e.indices.realGdp;
        lastGap = gap;
      },
    });
    if (result.failure) {
      firstFailure = assertRun(
        result,
        createNoPolicyReplayPackage(state, 96),
        i,
        shockPath,
      );
      break;
    }
  }
  if (firstFailure) {
    await save("moments-first-failure.json", firstFailure);
    throw Error("No-policy moment batch failed; replay saved");
  }
  const diagnostics = {
    gdpMonthlyGrowthStd: std(gdpGrowth),
    outputGapStd: std(gaps),
    outputGapAutocorrelation: correlation(previousGap, nextGap),
    gdpUnemploymentCorrelation: correlation(gdpGrowth, u),
    inflationStd: std(inflation),
    fxP99: [...fx].sort((a, b) => a - b)[Math.floor(fx.length * 0.99)]!,
    regimeFrequency: Object.fromEntries(
      Object.entries(regime).map(([k, v]) => [k, v / gaps.length]),
    ),
    distribution: Object.fromEntries(
      (
        [
          ["gdpMonthlyGrowth", gdpGrowth],
          ["outputGap", gaps],
          ["inflationAnnual", inflation],
          ["unemployment", u],
          ["fx", fx],
        ] as const
      ).map(([name, observations]) => [
        name,
        {
          median: median(observations),
          p10: quantile(observations, 0.1),
          p90: quantile(observations, 0.9),
        },
      ]),
    ),
    crisisFrequency: u.filter((v) => v >= 0.15).length / u.length,
  };
  const target = pack.calibrationTargets.moments.find(
    (x) => x.targetId === "GDP-MONTHLY-VOL",
  )!;
  const tail = pack.calibrationTargets.tailBands.find(
    (x) => x.targetId === "FX-TAIL",
  )!;
  const checks = [
    {
      id: target.targetId,
      observed: diagnostics.gdpMonthlyGrowthStd,
      min: target.min,
      max: target.max,
      pass:
        diagnostics.gdpMonthlyGrowthStd >= target.min &&
        diagnostics.gdpMonthlyGrowthStd <= target.max,
    },
    {
      id: tail.targetId,
      observed: diagnostics.fxP99,
      min: tail.min,
      max: tail.max,
      pass: diagnostics.fxP99 >= tail.min && diagnostics.fxP99 <= tail.max,
    },
  ];
  await save("moments.json", {
    schemaVersion: 1,
    kind: "no-policy-moments",
    ...identity,
    runs,
    months: 96,
    burnInMonths: 12,
    observations: gaps.length,
    diagnostics,
    checks,
  });
  if (checks.some((x) => !x.pass))
    throw Error("Moment band failed; inspect moments.json");
  console.log(
    `No-policy moments: ${runs}/1000 seeds, ${gaps.length} post burn-in months, gates passed; ${out}/moments.json`,
  );
}
interface GateRow {
  readonly targetId?: string;
  readonly id?: string;
  readonly observed?: number;
  readonly month?: number;
  readonly min?: number;
  readonly max?: number;
  readonly pass: boolean;
}
function gateId(row: GateRow): string {
  const id = row.targetId ?? row.id;
  if (!id) throw Error("Calibration gate lacks an ID");
  return id;
}
function gateValue(row: GateRow): number {
  const observed = row.observed ?? row.month;
  if (observed === undefined)
    throw Error(`Calibration gate ${gateId(row)} lacks an observation`);
  return observed;
}
async function diff() {
  const previous = JSON.parse(
      await readFile(resolve(options.get("--previous") ?? ""), "utf8"),
    ),
    current = JSON.parse(
      await readFile(resolve(options.get("--current") ?? ""), "utf8"),
    );
  const oldRows = [
    ...(previous.targetResults ?? []),
    ...(previous.checks ?? []),
  ] as GateRow[];
  const old = new Map(oldRows.map((x) => [gateId(x), gateValue(x)]));
  const currentRows = [
    ...(current.targetResults ?? []),
    ...(current.checks ?? []),
  ] as GateRow[];
  const changes = currentRows.map((x) => {
    const id = gateId(x);
    const current = gateValue(x);
    const previous = old.get(id);
    return {
      id,
      previous: previous ?? null,
      current,
      delta: previous === undefined ? null : current - previous,
    };
  });
  await save("diff.json", {
    previousConfigHash: previous.configHash,
    currentConfigHash: current.configHash,
    changes,
  });
  console.log(`${out}/diff.json`);
}
async function report() {
  const irfData = JSON.parse(
      await readFile(
        resolve(options.get("--irf") ?? resolve(out, "irf.json")),
        "utf8",
      ),
    ),
    momentData = JSON.parse(
      await readFile(
        resolve(options.get("--moments") ?? resolve(out, "moments.json")),
        "utf8",
      ),
    );
  if (
    irfData.configHash !== momentData.configHash ||
    irfData.engineVersion !== momentData.engineVersion
  )
    throw Error("Cannot combine reports from different config/engine versions");
  const lines = [
    "# SCN-01 calibration report",
    "",
    `Engine ${irfData.engineVersion}, model ${irfData.modelVersion}, config ${irfData.configHash}.`,
    `Paired IRF: ${irfData.runs} seeds; no-policy moments: ${momentData.runs} seeds × ${momentData.months} months, first ${momentData.burnInMonths} excluded.`,
    "",
    "| Gate | Observed | Band | Result |",
    "| --- | ---: | ---: | --- |",
    ...(
      [
        ...irfData.targetResults,
        ...irfData.checks,
        ...momentData.checks,
      ] as GateRow[]
    ).map(
      (x) =>
        `| ${gateId(x)} | ${gateValue(x).toFixed(5)} | ${x.min ?? "–"} to ${x.max ?? "–"} | ${x.pass ? "PASS" : "FAIL"} |`,
    ),
    "",
    `Moment diagnostics: ${JSON.stringify(momentData.diagnostics)}`,
    "",
  ];
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, "report.md"), lines.join("\n"));
  console.log(`${out}/report.md`);
}
switch (command) {
  case "irf":
    await irf();
    break;
  case "moments":
    await moments();
    break;
  case "diff":
    await diff();
    break;
  case "report":
    await report();
    break;
  default:
    throw Error("Use irf | moments | diff | report");
}
