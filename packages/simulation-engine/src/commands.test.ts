import { beforeAll, describe, expect, it } from "vitest";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
} from "@macro-nation/model-config";
import {
  stockLevel,
  type GameState,
  type VersionTuple,
} from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  activateDuePolicies,
  applyPolicyCommand,
  createSCN01InitialState,
  policyMeetingStatus,
  policyStateHash,
  runNoPolicyHeadless,
  runPolicyHeadless,
  submitPolicyCommand,
  type PolicyCommand,
  type PolicyDraft,
  type PolicyStateRepository,
} from "./index";

let initial: GameState;
beforeAll(async () => {
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
  initial = createSCN01InitialState({
    configSnapshot: snapshot,
    seed: "quarterly-command-v1",
    versions,
  });
});
const draft = (
  state: GameState,
  policyId: string,
  ruleId = "interest-rate",
  value = 0.03,
  quartersAhead = 0,
): PolicyDraft => ({
  status: "previewed",
  policyId,
  ruleId,
  value,
  quartersAhead,
  previewStateHash: policyStateHash(state),
});
const commit = (
  state: GameState,
  policyId: string,
  ruleId?: string,
  value?: number,
  quartersAhead?: number,
): Extract<PolicyCommand, { kind: "commit" }> => ({
  kind: "commit",
  commandId: `commit-${policyId}`,
  expectedStateHash: policyStateHash(state),
  draft: draft(state, policyId, ruleId, value, quartersAhead),
});

describe("quarterly policy commands", () => {
  it("uses exactly three actions per quarter, with no fourth commitment", () => {
    let state = initial;
    for (const id of ["one", "two", "three"]) {
      const command = commit(state, id);
      const result = applyPolicyCommand(state, command);
      expect(result.applied).toBe(true);
      state = result.state;
    }
    expect(policyMeetingStatus(state)).toMatchObject({
      quarter: 0,
      slotsRemaining: 0,
      nextPolicyMonth: 3,
    });
    expect(() => applyPolicyCommand(state, commit(state, "four"))).toThrow(
      /slots exhausted/,
    );
    expect(initial.policyAdministration).toBeUndefined();
  });

  it("replays a command without spending a slot or cost and rejects conflicting payloads", () => {
    const command = commit(initial, "one");
    const first = applyPolicyCommand(initial, command);
    const retry = applyPolicyCommand(first.state, command);
    expect(retry.applied).toBe(false);
    expect(retry.state).toBe(first.state);
    expect(first.state.policies.reserved).toHaveLength(1);
    expect(() =>
      applyPolicyCommand(first.state, {
        ...command,
        draft: { ...command.draft, value: 0.04 },
      }),
    ).toThrow(/payload conflict/);
    expect(() =>
      applyPolicyCommand(first.state, commit(initial, "other")),
    ).toThrow(/Stale/);
  });

  it("holds costs at confirmation and releases the precise reservation on cancellation", () => {
    const limited = {
      ...initial,
      economy: {
        ...initial.economy,
        stocks: { ...initial.economy.stocks, foreignReserves: stockLevel(80) },
      },
    };
    const first = applyPolicyCommand(
      limited,
      commit(limited, "buy-one", "fx-intervention", 0.05),
    );
    expect(first.state.resources.reservedForeignReserves).toBe(60);
    expect(first.state.economy.stocks.foreignReserves).toBe(80);
    expect(() =>
      applyPolicyCommand(
        first.state,
        commit(first.state, "buy-two", "fx-intervention", 0.05),
      ),
    ).toThrow(/available foreignReserves/);
    const cancel: PolicyCommand = {
      kind: "cancel",
      commandId: "cancel-buy-one",
      policyId: "buy-one",
      expectedStateHash: policyStateHash(first.state),
    };
    const result = applyPolicyCommand(first.state, cancel);
    expect(result.state.resources.reservedForeignReserves).toBe(0);
    expect(result.state.policies.cancelled).toMatchObject([
      { policyId: "buy-one", status: "cancelled" },
    ]);
    expect(result.state.resources.politicalCapital).toBe(
      limited.resources.politicalCapital - 1,
    );
    expect(result.slotsRemaining).toBe(1);
    expect(result.causal[0]!.contributions[0]!.sourceId).toBe("buy-one");
    expect(applyPolicyCommand(result.state, cancel).applied).toBe(false);
  });

  it("amends a reservation atomically and activates it once on a quarter boundary", () => {
    const monthOne = runNoPolicyHeadless({
      initialState: initial,
      tickCount: 1,
    }).finalState;
    const first = applyPolicyCommand(
      monthOne,
      commit(monthOne, "future", "fx-intervention", 0.01, 1),
    );
    expect(first.state.policies.reserved[0]!.activationMonth).toBe(3);
    const command: PolicyCommand = {
      kind: "amend",
      commandId: "amend-future",
      policyId: "future",
      expectedStateHash: policyStateHash(first.state),
      draft: draft(first.state, "future", "fx-intervention", 0.02, 1),
    };
    const changed = applyPolicyCommand(first.state, command);
    expect(changed.state.policyAdministration?.reservations).toMatchObject([
      {
        policyId: "future",
        costs: {
          foreignReserves: monthOne.economy.indices.realGdp * 12 * 0.02,
        },
      },
    ]);
    expect(changed.state.policyAdministration?.receipts).toHaveLength(2);
    const before = runPolicyHeadless({
      initialState: changed.state,
      tickCount: 2,
    });
    expect(before.failure).toBeNull();
    expect(before.finalState.policies.reserved).toHaveLength(1);
    const after = runPolicyHeadless({
      initialState: before.finalState,
      tickCount: 1,
    });
    expect(after.failure).toBeNull();
    expect(after.finalState.policies.reserved).toEqual([]);
    expect(after.finalState.policies.active).toHaveLength(1);
    expect(after.finalState.policyAdministration?.reservations).toEqual([]);
    expect(after.finalState.resources.reservedForeignReserves).toBe(0);
    expect(after.finalState.economy.stocks.foreignReserves).toBeLessThan(
      before.finalState.economy.stocks.foreignReserves,
    );
    expect(activateDuePolicies(after.finalState).state).toBe(after.finalState);
  });

  it("protects a booked reserve from monthly changes until its activation", () => {
    const limited: GameState = {
      ...initial,
      economy: {
        ...initial.economy,
        stocks: { ...initial.economy.stocks, foreignReserves: stockLevel(60) },
      },
    };
    const booked = applyPolicyCommand(
      limited,
      commit(limited, "escrow", "fx-intervention", 0.05, 1),
    ).state;
    const pending = runPolicyHeadless({ initialState: booked, tickCount: 3 });
    expect(pending.failure).toBeNull();
    expect(pending.finalState.economy.stocks.foreignReserves).toBeGreaterThanOrEqual(60);
    const activated = runPolicyHeadless({
      initialState: pending.finalState,
      tickCount: 1,
    });
    expect(activated.failure).toBeNull();
    expect(activated.finalState.policies.active).toHaveLength(1);
    expect(activated.finalState.policyAdministration?.reservations).toEqual([]);
  });

  it("does not report success until a durable save resolves, including a racing resend", async () => {
    let saved = initial;
    let fail = true;
    const repo: PolicyStateRepository = {
      async load() {
        return JSON.parse(JSON.stringify(saved)) as GameState;
      },
      async save(expected, next) {
        if (fail) throw new Error("storage unavailable");
        if (policyStateHash(saved) !== expected)
          throw new Error("concurrent save");
        saved = JSON.parse(JSON.stringify(next)) as GameState;
      },
    };
    const command = commit(initial, "durable");
    await expect(submitPolicyCommand(repo, 1, command)).rejects.toThrow(
      /storage unavailable/,
    );
    expect(saved.policies.reserved).toEqual([]);
    fail = false;
    const first = await submitPolicyCommand(repo, 1, command);
    const replay = await submitPolicyCommand(repo, 1, command);
    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);
    expect(saved.policies.reserved).toHaveLength(1);
  });
});
