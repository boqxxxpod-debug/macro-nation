import { beforeAll, describe, expect, it } from "vitest";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
} from "@macro-nation/model-config";
import type {
  GameState,
  PolicyDecision,
  VersionTuple,
} from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  createSCN01InitialState,
  evaluatePolicyCombos,
} from "./index";

let state: GameState;
beforeAll(async () => {
  const pack = await loadSCN01ConfigPack();
  const configSnapshot = await createConfigSnapshot(pack);
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
  state = createSCN01InitialState({
    configSnapshot,
    versions,
    seed: "combo-evaluator-v1",
  });
});

function policy(
  policyId: string,
  type: PolicyDecision["type"],
  activationMonth = 0,
  endMonth = 11,
): PolicyDecision {
  return {
    policyId,
    type,
    decidedMonth: 0,
    activationMonth,
    endMonth,
    status: "active",
    slotQuarter: 0,
    costs: {
      politicalCapital: 0,
      implementationCapacity: 0,
      foreignReserves: 0,
      immediateBudget: 0,
    },
    sourceCommandId: policyId,
  };
}

describe("pure policy combo evaluator", () => {
  it("activates a synergy once with auditable combo effects and additional cost", () => {
    const result = evaluatePolicyCombos(
      state,
      [policy("tax", "taxPackage"), policy("works", "publicWorks")],
      0,
    );
    const combo = result.results.find(
      (item) => item.comboId === "growth-investment-package",
    );
    expect(combo).toMatchObject({ activated: true, overlapMonths: 12 });
    expect(result.costs).toMatchObject({
      politicalCapital: 2,
      implementationCapacity: 3,
    });
    expect(combo?.effects[0]).toMatchObject({
      sourceType: "combo",
      sourceId: "growth-investment-package",
      comboId: "growth-investment-package",
    });
    expect(
      evaluatePolicyCombos(
        { ...state, effects: combo!.effects },
        [policy("tax", "taxPackage"), policy("works", "publicWorks")],
        0,
      ).results.find((item) => item.comboId === combo?.comboId),
    ).toMatchObject({ activated: false, reason: "already-fired-this-month" });
  });

  it("reports near misses, forbidden policies, cancellation, and cost shortage separately", () => {
    const nearMiss = evaluatePolicyCombos(
      state,
      [policy("tax", "taxPackage", 0, 3), policy("works", "publicWorks", 0, 3)],
      0,
    ).results[0];
    expect(nearMiss).toMatchObject({
      activated: false,
      reason: "insufficient-overlap",
    });

    const forbidden = evaluatePolicyCombos(
      state,
      [
        policy("tax", "taxPackage"),
        policy("works", "publicWorks"),
        policy("tariff", "tariff"),
      ],
      0,
    );
    expect(forbidden.results[0]).toMatchObject({
      activated: false,
      reason: "forbidden-policy",
    });
    expect(forbidden.results[1]).toMatchObject({
      activated: true,
      kind: "cancellation",
    });

    const shortage = evaluatePolicyCombos(
      state,
      [policy("tax", "taxPackage"), policy("works", "publicWorks")],
      0,
      {
        politicalCapital: 1,
        implementationCapacity: 100,
        foreignReserves: 100,
        immediateBudget: 100,
      },
    );
    expect(shortage.results[0]).toMatchObject({
      activated: false,
      reason: "insufficient-additional-cost",
    });
    expect(shortage.effects).toEqual([]);
  });
});
