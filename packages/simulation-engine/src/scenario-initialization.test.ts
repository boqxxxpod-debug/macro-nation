import { describe, expect, it } from "vitest";
import {
  validateState,
  type GameState,
  type ScenarioId,
  type VersionTuple,
} from "@macro-nation/domain";
import {
  createConfigSnapshot,
  loadScenarioConfigPack,
  parseConfigPack,
} from "@macro-nation/model-config";
import {
  ENGINE_VERSION,
  activateDuePolicies,
  appendReview,
  createNoPolicyReplayPackage,
  createScenarioInitialState,
  createSCN01InitialState,
  createReservedPolicy,
  replayNoPolicyPackage,
  runNoPolicyHeadless,
  terminateActivePolicy,
} from "./index";

async function makeState(
  scenarioId: ScenarioId,
  initialOverrides?: Readonly<Record<string, number>>,
): Promise<GameState> {
  const loadedPack = await loadScenarioConfigPack(scenarioId);
  const pack = initialOverrides
    ? parseConfigPack({
        ...loadedPack,
        scenario: {
          ...loadedPack.scenario,
          initialState: {
            ...loadedPack.scenario.initialState,
            ...initialOverrides,
          },
        },
      })
    : loadedPack;
  const configSnapshot = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  const versions: VersionTuple = {
    saveSchemaVersion: "2",
    engineVersion: ENGINE_VERSION,
    configSchemaVersion: pack.manifest.configSchemaVersion,
    modelVersion: pack.manifest.modelVersion,
    calibrationVersion: pack.manifest.calibrationVersion,
    contentVersion: pack.manifest.contentVersion,
    rngVersion: pack.manifest.rngVersion,
    configVersion: pack.manifest.configVersion,
  };
  return createScenarioInitialState({
    configSnapshot,
    versions,
    seed: "issue-117-scenarios",
  });
}

describe("scenario initialization", () => {
  it("preserves the SCN-01 wrapper and its scenario guard", async () => {
    const state = await makeState("SCN-01");
    const input = {
      configSnapshot: state.configSnapshot,
      versions: state.versions,
      seed: state.rng.rootSeed,
    };
    expect(createSCN01InitialState(input)).toEqual(state);
    const other = await makeState("SCN-02");
    expect(() =>
      createSCN01InitialState({
        ...input,
        configSnapshot: other.configSnapshot,
        versions: other.versions,
      }),
    ).toThrow(/Expected SCN-01, got SCN-02/);
  });

  it.each([
    ["SCN-02", 0.005, 0.07, 0.065, 125, 1, 5, 55, 60],
    ["SCN-03", 0, 0.045, 0.07, 108, 0.95, 6, 60, 40],
  ] as const)(
    "initializes %s from the documented provisional table",
    async (
      id,
      growth,
      inflation,
      unemployment,
      fx,
      debtRatio,
      importMonths,
      trust,
      relations,
    ) => {
      const state = await makeState(id);
      const e = state.economy;
      expect(state.scenarioId).toBe(id);
      expect(state.clock.endMonth).toBe(96);
      expect(e.rates.inflationAnnual).toBe(inflation);
      expect(e.rates.expectedInflation).toBe(inflation);
      expect(e.rates.unemployment).toBe(unemployment);
      expect(e.indices.fx).toBe(fx);
      expect(e.indices.importPrice).toBe(fx);
      expect(e.ratios.governmentDebtRatio).toBeCloseTo(debtRatio);
      expect(e.stocks.foreignReserves / e.flows.imports).toBeCloseTo(
        importMonths,
      );
      expect(
        Math.pow(e.indices.realGdp / e.memory!.previousRealGdp!, 12) - 1,
      ).toBeCloseTo(growth);
      expect(e.sentiment.policyTrust).toBe(trust);
      expect(e.external.partnerRelations).toBe(relations);
      expect(validateState(state)).toEqual([]);
    },
  );

  it.each(["SCN-02", "SCN-03"] as const)(
    "replays %s through 96 months using its saved configuration",
    async (id) => {
      const initialState = await makeState(id);
      const result = runNoPolicyHeadless({
        initialState,
        tickCount: 96,
        collectTrace: false,
      });
      expect(result.failure).toBeNull();
      expect(result.invariantFailures).toEqual([]);
      expect(result.ticksCompleted).toBe(96);
      expect(result.finalState.runState).toBe("completed");
      const serialized = JSON.parse(
        JSON.stringify(createNoPolicyReplayPackage(initialState, 96)),
      );
      const replayed = replayNoPolicyPackage(serialized);
      expect(replayed.failure).toBeNull();
      expect(replayed.ticksCompleted).toBe(96);
      expect(replayed.finalState).toEqual(result.finalState);
      expect(initialState.monthIndex).toBe(0);
    },
    60_000,
  );

  it("uses snapshot overrides after serialization without loading the newest pack", async () => {
    const state = await makeState("SCN-02");
    const pack = await loadScenarioConfigPack("SCN-02");
    const startedPack = parseConfigPack({
      ...pack,
      scenario: {
        ...pack.scenario,
        initialState: { ...pack.scenario.initialState, inflationAnnual: 0.08 },
      },
    });
    const savedSnapshot = JSON.parse(
      JSON.stringify(
        await createConfigSnapshot(
          startedPack,
          startedPack.scenario.parameterOverrides,
        ),
      ),
    );
    const resumed = createScenarioInitialState({
      configSnapshot: savedSnapshot,
      versions: state.versions,
      seed: state.rng.rootSeed,
    });
    expect(resumed.economy.rates.inflationAnnual).toBe(0.08);
    expect(state.economy.rates.inflationAnnual).toBe(0.07);
  });

  it("keeps a scenario's public-investment override as its no-policy baseline", async () => {
    const initialState = await makeState("SCN-02", { publicInvestment: 7 });
    const result = runNoPolicyHeadless({ initialState, tickCount: 2 });
    expect(result.failure).toBeNull();
    expect(result.finalState.economy.flows.publicInvestment).toBe(7);
    expect(result.finalState.economy.stocks.publicCapital).toBe(0);
  });

  it("returns to the scenario policy rate after a temporary interest policy expires or is terminated", async () => {
    const initial = await makeState("SCN-02", { policyRate: 0.04 });
    const policy = createReservedPolicy(
      initial,
      "interest-rate",
      0.06,
      "temporary-rate",
    );
    const activated = activateDuePolicies({
      ...initial,
      policies: { ...initial.policies, reserved: [policy] },
    }).state;
    expect(activated.economy.rates.policyRate).toBe(0.06);
    const endMonth = activated.policies.active[0]!.endMonth!;
    expect(
      activateDuePolicies({ ...activated, monthIndex: endMonth }).state.economy
        .rates.policyRate,
    ).toBe(0.06);
    const expired = activateDuePolicies({
      ...activated,
      monthIndex: endMonth + 1,
    });
    expect(expired.state.economy.rates.policyRate).toBe(0.04);
    expect(expired.state.policies.completed).toHaveLength(1);
    expect(
      expired.causal.find((entry) => entry.indicatorId === "policyRate")
        ?.totalDelta,
    ).toBeCloseTo(-0.02);
    const terminated = terminateActivePolicy(activated, "temporary-rate");
    expect(terminated.state.economy.rates.policyRate).toBe(0.04);
  });

  it("uses the scenario GDP as the first headless review baseline", async () => {
    const initial = await makeState("SCN-02", { realGdp: 125 });
    const reviewed = appendReview({ ...initial, monthIndex: 60 }, []);
    expect(reviewed.history.reviews?.[0]?.axes.growth).toBe(50);
    expect(reviewed.history.reviews?.[0]?.axes.living).toBe(50);
  });
});
