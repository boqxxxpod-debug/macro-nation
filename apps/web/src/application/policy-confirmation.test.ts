import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  GameState,
  PolicyBook,
  PolicyCommandReceipt,
  PolicyDecision,
} from "@macro-nation/domain";
import {
  applyPolicyCommand,
  policyStateHash,
  runPolicyHeadless,
  submitPolicyCommand,
  type PolicyCommand,
} from "@macro-nation/simulation-engine";
import { IndexedDbGameRepository } from "../infrastructure/game-repository";
import { createGame } from "./game-service";
import { selectLatestConfirmedPolicy } from "./policy-confirmation";

let initial: GameState;
beforeAll(async () => {
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "latest-confirmed-policy",
  );
});

function policy(
  policyId: string,
  decidedMonth: number,
  status: PolicyDecision["status"],
): PolicyDecision {
  return {
    policyId,
    type: "interestRate",
    decidedMonth,
    activationMonth: decidedMonth,
    status,
    slotQuarter: Math.floor(decidedMonth / 3),
    costs: {
      politicalCapital: 1,
      implementationCapacity: 0,
      foreignReserves: 0,
      immediateBudget: 0,
    },
    sourceCommandId: `commit-${policyId}`,
    inputs: { value: 0.03 },
  };
}

function withPolicies(
  policies: Partial<PolicyBook>,
  receipts?: readonly PolicyCommandReceipt[],
): GameState {
  return {
    ...initial,
    policies: { ...initial.policies, ...policies },
    ...(receipts
      ? { policyAdministration: { reservations: [], receipts } }
      : {}),
  };
}

function commit(
  state: GameState,
  policyId: string,
  value = 0.03,
  quartersAhead = 0,
): Extract<PolicyCommand, { kind: "commit" }> {
  return {
    kind: "commit",
    commandId: `commit-${policyId}`,
    expectedStateHash: policyStateHash(state),
    draft: {
      status: "previewed",
      policyId,
      ruleId: "interest-rate",
      value,
      quartersAhead,
      previewStateHash: policyStateHash(state),
    },
  };
}

describe("latest confirmed policy selector", () => {
  it("returns no confirmation for a game without decisions", () => {
    expect(selectLatestConfirmedPolicy(initial)).toBeUndefined();
  });

  it("restores the same decision through saved reservation, activation and completion", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    await repository.create(initial);
    await submitPolicyCommand(repository, 1, commit(initial, "saved", 0.04));
    const reserved = (await new IndexedDbGameRepository(factory).load(1))!;
    expect(selectLatestConfirmedPolicy(reserved)).toMatchObject({
      policyId: "saved",
      inputs: { value: 0.04 },
      activationMonth: 0,
      status: "reserved",
    });

    const firstMonth = runPolicyHeadless({
      initialState: { ...reserved, runState: "running" },
      tickCount: 1,
    });
    expect(firstMonth.failure).toBeNull();
    await repository.save(policyStateHash(reserved), firstMonth.finalState);
    const active = (await new IndexedDbGameRepository(factory).load(1))!;
    expect(selectLatestConfirmedPolicy(active)?.status).toBe("active");

    const remaining = runPolicyHeadless({
      initialState: active,
      tickCount: 12,
    });
    expect(remaining.failure).toBeNull();
    await repository.save(policyStateHash(active), remaining.finalState);
    const completed = (await new IndexedDbGameRepository(factory).load(1))!;
    expect(selectLatestConfirmedPolicy(completed)).toMatchObject({
      policyId: "saved",
      inputs: { value: 0.04 },
      status: "completed",
    });
  });

  it("uses confirmation order when same-month decisions move into different buckets", () => {
    let state = applyPolicyCommand(
      initial,
      commit(initial, "older", 0.03, 3),
    ).state;
    state = applyPolicyCommand(state, commit(state, "newer", 0.04)).state;
    const latest = state.policies.reserved[1]!;
    const completed: GameState = {
      ...state,
      policies: {
        ...state.policies,
        reserved: [state.policies.reserved[0]!],
        completed: [{ ...latest, status: "completed" }],
      },
    };
    expect(selectLatestConfirmedPolicy(completed)).toBe(
      completed.policies.completed[0],
    );
  });

  it("restores a same-month amendment even when a different reservation is last in its bucket", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    await repository.create(initial);
    let state = (
      await submitPolicyCommand(repository, 1, commit(initial, "first"))
    ).state;
    state = (
      await submitPolicyCommand(repository, 1, commit(state, "second", 0.05))
    ).state;
    const amended: PolicyCommand = {
      kind: "amend",
      commandId: "amend-first",
      policyId: "first",
      expectedStateHash: policyStateHash(state),
      draft: { ...commit(state, "first", 0.04, 1).draft },
    };
    await submitPolicyCommand(repository, 1, amended);
    const reloaded = (await new IndexedDbGameRepository(factory).load(1))!;
    expect(reloaded.policies.reserved.at(-1)?.policyId).toBe("second");
    expect(selectLatestConfirmedPolicy(reloaded)).toMatchObject({
      policyId: "first",
      inputs: { value: 0.04 },
      activationMonth: 3,
      status: "reserved",
    });
  });

  it("keeps the latest confirmed decision visible with its saved cancelled status", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    await repository.create(initial);
    let state = (
      await submitPolicyCommand(repository, 1, commit(initial, "older"))
    ).state;
    state = (
      await submitPolicyCommand(repository, 1, commit(state, "latest", 0.04, 1))
    ).state;
    await submitPolicyCommand(repository, 1, {
      kind: "cancel",
      commandId: "cancel-latest",
      policyId: "latest",
      expectedStateHash: policyStateHash(state),
    });
    const reloaded = (await new IndexedDbGameRepository(factory).load(1))!;
    expect(selectLatestConfirmedPolicy(reloaded)).toMatchObject({
      policyId: "latest",
      inputs: { value: 0.04 },
      activationMonth: 3,
      status: "cancelled",
    });
  });

  it("does not make an older decision latest when it is cancelled after another confirmation", () => {
    let state = applyPolicyCommand(initial, commit(initial, "older")).state;
    state = applyPolicyCommand(state, commit(state, "latest", 0.04)).state;
    state = applyPolicyCommand(state, {
      kind: "cancel",
      commandId: "cancel-older",
      policyId: "older",
      expectedStateHash: policyStateHash(state),
    }).state;
    expect(selectLatestConfirmedPolicy(state)?.policyId).toBe("latest");
  });

  it("uses decision months across every lifecycle bucket for saves without receipts", () => {
    const latest = policy("completed", 8, "completed");
    const state = withPolicies({
      reserved: [policy("reserved", 5, "reserved")],
      active: [policy("active", 6, "active")],
      completed: [latest],
      cancelled: [policy("cancelled", 7, "cancelled")],
    });
    expect(selectLatestConfirmedPolicy(state)).toBe(latest);
  });

  it("uses a stable bucket and entry order when legacy decision months tie", () => {
    const last = policy("last-cancelled", 2, "cancelled");
    const state = withPolicies({
      reserved: [policy("reserved", 2, "reserved")],
      active: [policy("active", 2, "active")],
      completed: [policy("completed", 2, "completed")],
      cancelled: [policy("first-cancelled", 2, "cancelled"), last],
    });
    expect(selectLatestConfirmedPolicy(state)).toBe(last);
    expect(selectLatestConfirmedPolicy(structuredClone(state))).toEqual(last);
  });

  it("does not treat synthetic legacy receipts as chronological confirmations", () => {
    const latest = policy("newer-reservation", 5, "reserved");
    const older = policy("older-completion", 2, "completed");
    const state = withPolicies(
      { reserved: [latest], completed: [older] },
      [latest, older].map((decision) => ({
        kind: "commit",
        commandId: decision.sourceCommandId,
        policyId: decision.policyId,
        fingerprint: "legacy",
        quarter: decision.slotQuarter,
        monthIndex: decision.decidedMonth,
      })),
    );
    expect(selectLatestConfirmedPolicy(state)).toBe(latest);
  });

  it("preserves missing legacy inputs and reads frozen state without changing saved data", () => {
    const legacy: PolicyDecision = {
      policyId: "legacy",
      type: "interestRate",
      decidedMonth: 4,
      activationMonth: 6,
      status: "reserved",
      slotQuarter: 1,
      costs: {
        politicalCapital: 1,
        implementationCapacity: 0,
        foreignReserves: 0,
        immediateBudget: 0,
      },
      sourceCommandId: "legacy-command",
    };
    const state = withPolicies({ reserved: [legacy] });
    const before = structuredClone(state);
    Object.freeze(legacy.costs);
    Object.freeze(legacy);
    for (const bucket of Object.values(state.policies)) Object.freeze(bucket);
    Object.freeze(state.policies);
    Object.freeze(state);
    expect(selectLatestConfirmedPolicy(state)).toBe(legacy);
    expect(selectLatestConfirmedPolicy(state)?.inputs).toBeUndefined();
    expect(state).toEqual(before);
  });
});
