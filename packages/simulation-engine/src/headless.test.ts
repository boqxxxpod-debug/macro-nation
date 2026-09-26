import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
  stableStringify,
} from "@macro-nation/model-config";
import type { GameState, VersionTuple } from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  createNoPolicyReplayPackage,
  createSCN01InitialState,
  replayNoPolicyPackage,
  runNoPolicyHeadless,
} from "./index";

interface NoPolicyGoldenFixture {
  readonly schemaVersion: number;
  readonly scenarioId: string;
  readonly seed: string;
  readonly engineVersion: string;
  readonly modelVersion: string;
  readonly calibrationVersion: string;
  readonly rngVersion: string;
  readonly traceNumberDecimals: number;
  readonly configHash: string;
  readonly traceSha256: Readonly<Record<string, string>>;
}

const goldenFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/scn01-no-policy-golden-v9.json", import.meta.url),
    "utf8",
  ),
) as NoPolicyGoldenFixture;

let fixture: ReturnType<typeof createSCN01InitialState>;
let versions: VersionTuple;
let configHash = "";

function makeState(
  seed: string,
  durationMode?: "short" | "standard" | "long" | "ultraLong",
): GameState {
  return createSCN01InitialState({
    configSnapshot: fixture.configSnapshot,
    seed,
    versions,
    ...(durationMode ? { durationMode } : {}),
  });
}

function roundTraceNumbers(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? Number(value.toFixed(goldenFixture.traceNumberDecimals))
      : value;
  }
  if (Array.isArray(value)) return value.map(roundTraceNumbers);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        roundTraceNumbers(entry),
      ]),
    );
  }
  return value;
}

function traceHash(result: ReturnType<typeof runNoPolicyHeadless>): string {
  const normalizedTrace = roundTraceNumbers({
    strategyId: result.strategyId,
    requestedTicks: result.requestedTicks,
    ticksCompleted: result.ticksCompleted,
    finalState: result.finalState,
    records: result.records,
    invariantFailures: result.invariantFailures,
    failure: result.failure,
  });
  return createHash("sha256")
    .update(stableStringify(normalizedTrace))
    .digest("hex");
}

beforeAll(async () => {
  const pack = await loadSCN01ConfigPack();
  const snapshot = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  configHash = snapshot.configHash;
  versions = {
    saveSchemaVersion: "2",
    engineVersion: ENGINE_VERSION,
    configSchemaVersion: pack.manifest.configSchemaVersion,
    modelVersion: pack.manifest.modelVersion,
    calibrationVersion: pack.manifest.calibrationVersion,
    contentVersion: pack.manifest.contentVersion,
    rngVersion: pack.manifest.rngVersion,
    configVersion: pack.manifest.configVersion,
  };
  fixture = createSCN01InitialState({
    configSnapshot: snapshot,
    seed: goldenFixture.seed,
    versions,
  });
});

describe("SCN-01 no-policy headless runner", () => {
  it.each([
    ["short", 48],
    ["standard", 96],
    ["long", 240],
    ["ultraLong", 360],
  ] as const)("stops %s exactly at month %i", (mode, months) => {
    const result = runNoPolicyHeadless({
      initialState: makeState(`duration-${mode}`, mode),
      tickCount: months + 1,
      collectTrace: false,
    });
    expect(result.failure).toBeNull();
    expect(result.ticksCompleted).toBe(months);
    expect(result.finalState.runState).toBe("completed");
    expect(result.finalState.clock.endMonth).toBe(months);
    expect(result.finalState.clock.durationMode).toBe(mode);
  });

  it("keeps six reviews and three structural updates unique over 30 years", () => {
    const initialState = makeState("thirty-years", "ultraLong");
    const result = runNoPolicyHeadless({ initialState, tickCount: 360 });
    expect(result.failure).toBeNull();
    expect(
      result.finalState.history.reviews?.map((item) => item.monthIndex),
    ).toEqual([60, 120, 180, 240, 300, 360]);
    const markers = result.finalState.history.appliedMilestones ?? [];
    expect(markers).toHaveLength(9);
    expect(new Set(markers).size).toBe(9);
    expect(markers.filter((key) => key.includes(":structure:"))).toEqual([
      "headless-thirty-years:structure:120",
      "headless-thirty-years:structure:240",
      "headless-thirty-years:structure:360",
    ]);
    expect(result.finalState.longTerm?.population).toBeLessThan(
      (
        initialState.configSnapshot.normalizedConfig.nation as {
          population: number;
        }
      ).population,
    );
    expect(result.finalState.longTerm?.technologyIndex).toBeGreaterThan(100);
    expect(
      replayNoPolicyPackage(createNoPolicyReplayPackage(initialState, 360))
        .finalState,
    ).toEqual(result.finalState);
  });

  it("reports 12-step progress and only cancels at a 96-step checkpoint", () => {
    const progress: number[] = [];
    const checkpoints: number[] = [];
    const result = runNoPolicyHeadless({
      initialState: makeState("checkpoint", "ultraLong"),
      tickCount: 360,
      collectTrace: false,
      onProgress: (completed) => progress.push(completed),
      onCheckpoint: (state) => {
        checkpoints.push(state.monthIndex);
        return state.monthIndex < 192;
      },
    });
    expect(result.failure?.code).toBe("BATCH_CANCELLED");
    expect(result.ticksCompleted).toBe(192);
    expect(checkpoints).toEqual([96, 192]);
    expect(progress).toEqual(
      Array.from({ length: 16 }, (_, index) => (index + 1) * 12),
    );
  });

  it("stops a long no-policy run at a crisis before unstable debt growth", () => {
    const initialState = makeState("issue16-long-0001", "ultraLong");
    const result = runNoPolicyHeadless({
      initialState,
      tickCount: 360,
      collectTrace: false,
      stopOnCrisis: true,
    });
    expect(result.failure).toBeNull();
    expect(result.ticksCompleted).toBeLessThan(335);
    expect(result.finalState.runState).toBe("crisisStopped");
    expect(result.invariantFailures).toEqual([]);
    expect(
      replayNoPolicyPackage(
        createNoPolicyReplayPackage(initialState, 360, true),
      ).finalState,
    ).toEqual(result.finalState);
  });
  it.each(["scn01-no-policy-1000-0007", "scn01-no-policy-1000-0009"])(
    "completes the formerly failing 96-month boundary seed %s",
    (seed) => {
      const initialState = makeState(seed);
      const result = runNoPolicyHeadless({ initialState, tickCount: 96 });
      expect(result.failure).toBeNull();
      expect(result.ticksCompleted).toBe(96);
      expect(result.invariantFailures).toEqual([]);
      expect(result.records).toHaveLength(96);
      for (const record of result.records) {
        const { flows, indices } = record.state.economy;
        expect(flows.exports).toBeGreaterThanOrEqual(0);
        expect(
          flows.consumption +
            flows.investment +
            flows.governmentConsumption +
            flows.exports -
            flows.imports,
        ).toBeCloseTo(indices.realGdp, 8);
      }
      expect(initialState.monthIndex).toBe(0);
    },
  );
  it.each([48, 96])(
    "completes %i monthly ticks with finite state and reconciled causal totals",
    (ticks) => {
      const result = runNoPolicyHeadless({
        initialState: makeState(`baseline-${ticks}`),
        tickCount: ticks,
      });

      expect(result.failure).toBeNull();
      expect(result.invariantFailures).toEqual([]);
      expect(result.ticksCompleted).toBe(ticks);
      expect(result.finalState.tickSequence).toBe(ticks);
      expect(result.finalState.monthIndex).toBe(ticks);
      expect(result.records).toHaveLength(ticks);
      for (const record of result.records) {
        expect(record.state.tickSequence).toBe(record.monthIndex + 1);
        expect(record.state.economy.flows.currentAccount).toBeCloseTo(
          record.state.economy.flows.exports -
            record.state.economy.flows.imports,
          9,
        );
        for (const entry of record.diagnostics.causal) {
          const total = entry.contributions.reduce(
            (sum, item) => sum + item.delta,
            0,
          );
          expect(total).toBeCloseTo(entry.totalDelta, 8);
        }
      }
    },
  );

  it("reproduces the same state trace from a serialized replay package", () => {
    const initialState = makeState("serialized-replay-seed");
    const expected = runNoPolicyHeadless({ initialState, tickCount: 48 });
    const serialized = JSON.stringify(
      createNoPolicyReplayPackage(initialState, 48),
    );
    const replay = replayNoPolicyPackage(JSON.parse(serialized));

    expect(replay).toEqual(expected);
  });

  it("keeps the final state while omitting monthly records for batch runs", () => {
    const result = runNoPolicyHeadless({
      initialState: makeState("compact-batch-seed"),
      tickCount: 48,
      collectTrace: false,
    });

    expect(result.failure).toBeNull();
    expect(result.ticksCompleted).toBe(48);
    expect(result.records).toEqual([]);
    expect(result.finalState.monthIndex).toBe(48);
  });

  it("rejects policies, scheduled effects, and events in a no-policy baseline", () => {
    const initialState = makeState("no-policy-precondition-seed");
    const blockedStates: readonly [GameState, string][] = [
      [
        {
          ...initialState,
          policies: {
            ...initialState.policies,
            active: [{} as GameState["policies"]["active"][number]],
          },
        },
        "NOT_NO_POLICY_STATE",
      ],
      [
        { ...initialState, effects: [{} as GameState["effects"][number]] },
        "NOT_NO_POLICY_STATE",
      ],
      [
        {
          ...initialState,
          events: { ...initialState.events, activeEventIds: ["event-1"] },
        },
        "NOT_NO_EVENT_STATE",
      ],
    ];

    for (const [state, code] of blockedStates) {
      const result = runNoPolicyHeadless({
        initialState: state,
        tickCount: 48,
      });
      expect(result.ticksCompleted).toBe(0);
      expect(result.failure).toMatchObject({ kind: "precondition", code });
    }
  });

  it("changes the stochastic trace when the seed changes", () => {
    const first = runNoPolicyHeadless({
      initialState: makeState("seed-a"),
      tickCount: 48,
    });
    const second = runNoPolicyHeadless({
      initialState: makeState("seed-b"),
      tickCount: 48,
    });

    expect(first.failure).toBeNull();
    expect(second.failure).toBeNull();
    expect(first.finalState).not.toEqual(second.finalState);
  });

  it("reports the first invalid input month and paths", () => {
    const invalid = {
      ...makeState("invalid-seed"),
      economy: {
        ...makeState("invalid-seed").economy,
        indices: {
          ...makeState("invalid-seed").economy.indices,
          realGdp: Number.NaN,
        },
      },
    } as unknown as GameState;
    const result = runNoPolicyHeadless({
      initialState: invalid,
      tickCount: 48,
    });

    expect(result.ticksCompleted).toBe(0);
    expect(result.failure).toMatchObject({
      kind: "invariant",
      monthIndex: 0,
      code: "INVALID_INITIAL_STATE",
    });
    expect(result.failure?.paths).toContain("economy.indices.realGdp");
  });

  it("rejects a replay package from another engine version or config", () => {
    const initialState = makeState("version-guard-seed");
    const replay = createNoPolicyReplayPackage(initialState, 48);

    expect(() =>
      replayNoPolicyPackage({ ...replay, engineVersion: "99.0.0" }),
    ).toThrow(/does not match/);
    expect(() =>
      replayNoPolicyPackage({ ...replay, configHash: "0".repeat(64) }),
    ).toThrow(/config hash/);
  });

  it("matches the versioned 48- and 96-month baseline golden traces", () => {
    expect({
      schemaVersion: goldenFixture.schemaVersion,
      scenarioId: fixture.scenarioId,
      seed: fixture.rng.rootSeed,
      engineVersion: versions.engineVersion,
      modelVersion: versions.modelVersion,
      calibrationVersion: versions.calibrationVersion,
      rngVersion: versions.rngVersion,
      configHash,
    }).toEqual({
      schemaVersion: goldenFixture.schemaVersion,
      scenarioId: goldenFixture.scenarioId,
      seed: goldenFixture.seed,
      engineVersion: goldenFixture.engineVersion,
      modelVersion: goldenFixture.modelVersion,
      calibrationVersion: goldenFixture.calibrationVersion,
      rngVersion: goldenFixture.rngVersion,
      configHash: goldenFixture.configHash,
    });

    for (const ticks of [48, 96]) {
      const result = runNoPolicyHeadless({
        initialState: fixture,
        tickCount: ticks,
      });
      expect(result.failure).toBeNull();
      expect(traceHash(result)).toBe(goldenFixture.traceSha256[String(ticks)]);
    }
  });
});
