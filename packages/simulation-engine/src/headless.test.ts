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
  readonly configHash: string;
  readonly traceSha256: Readonly<Record<string, string>>;
}

const goldenFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/scn01-no-policy-golden-v1.json", import.meta.url),
    "utf8",
  ),
) as NoPolicyGoldenFixture;

let fixture: ReturnType<typeof createSCN01InitialState>;
let versions: VersionTuple;
let configHash = "";

function makeState(seed: string): GameState {
  return createSCN01InitialState({
    configSnapshot: fixture.configSnapshot,
    seed,
    versions,
  });
}

function traceHash(result: ReturnType<typeof runNoPolicyHeadless>): string {
  return createHash("sha256")
    .update(
      stableStringify({
        strategyId: result.strategyId,
        requestedTicks: result.requestedTicks,
        ticksCompleted: result.ticksCompleted,
        finalState: result.finalState,
        records: result.records,
        invariantFailures: result.invariantFailures,
        failure: result.failure,
      }),
    )
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
    saveSchemaVersion: "1",
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
