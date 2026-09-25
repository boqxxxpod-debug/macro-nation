import {
  scorePoint,
  stockLevel,
  type CausalContribution,
  type GameState,
  type PolicyAdministration,
  type PolicyCommandReceipt,
  type PolicyCosts,
  type PolicyDecision,
  type ResourceReservation,
} from "@macro-nation/domain";
import { createContributionBuilder } from "./causal";
import { createReservedPolicy, policyRules } from "./policy-effects";

export interface PolicyDraft {
  readonly status: "draft" | "previewed";
  readonly policyId: string;
  readonly ruleId: string;
  readonly value: number;
  readonly quartersAhead: number;
  readonly previewStateHash?: string;
}

export type PolicyCommand =
  | {
      readonly kind: "commit";
      readonly commandId: string;
      readonly expectedStateHash: string;
      readonly draft: PolicyDraft;
    }
  | {
      readonly kind: "amend";
      readonly commandId: string;
      readonly expectedStateHash: string;
      readonly policyId: string;
      readonly draft: PolicyDraft;
    }
  | {
      readonly kind: "cancel";
      readonly commandId: string;
      readonly expectedStateHash: string;
      readonly policyId: string;
    };

export interface PolicyCommandResult {
  readonly state: GameState;
  readonly applied: boolean;
  readonly slotsRemaining: number;
  readonly nextPolicyMonth: number;
  readonly causal: readonly CausalContribution[];
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = value as Record<string, unknown>;
  return `{${Object.keys(entries)
    .sort()
    .filter((key) => entries[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical(entries[key])}`)
    .join(",")}}`;
}

/** Stable across object property order, including reloads from JSON storage. */
export function policyStateHash(state: GameState): string {
  const identity = {
    ...state,
    configSnapshot: { configHash: state.configSnapshot.configHash },
  };
  let hash = 0xcbf29ce484222325n;
  for (const character of new TextEncoder().encode(canonical(identity))) {
    hash ^= BigInt(character);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function administration(state: GameState): PolicyAdministration {
  if (state.policyAdministration) return state.policyAdministration;
  const all = [
    ...state.policies.reserved,
    ...state.policies.active,
    ...state.policies.completed,
    ...state.policies.cancelled,
  ];
  return {
    reservations: state.policies.reserved.map((policy) => ({
      reservationId: policy.reservationId ?? policy.policyId,
      policyId: policy.policyId,
      costs: policy.costs,
    })),
    receipts: all.map((policy) => ({
      commandId: policy.sourceCommandId,
      fingerprint: "legacy",
      quarter: policy.slotQuarter,
      monthIndex: policy.decidedMonth,
      kind: "commit" as const,
      policyId: policy.policyId,
    })),
  };
}

export function policyMeetingStatus(state: GameState): {
  readonly quarter: number;
  readonly slotsRemaining: number;
  readonly nextPolicyMonth: number;
} {
  const cycle = state.clock.config.policyCycleSteps;
  const quarter = Math.floor(state.monthIndex / cycle);
  const used = administration(state).receipts.filter(
    (receipt) => receipt.quarter === quarter,
  ).length;
  return {
    quarter,
    slotsRemaining: Math.max(0, 3 - used),
    nextPolicyMonth: (quarter + 1) * cycle,
  };
}

function available(
  state: GameState,
  reservations: readonly ResourceReservation[],
) {
  const held = reservations.reduce(
    (total, item) => ({
      politicalCapital: total.politicalCapital + item.costs.politicalCapital,
      implementationCapacity:
        total.implementationCapacity + item.costs.implementationCapacity,
      foreignReserves: total.foreignReserves + item.costs.foreignReserves,
      immediateBudget: total.immediateBudget + item.costs.immediateBudget,
    }),
    {
      politicalCapital: 0,
      implementationCapacity: 0,
      foreignReserves: 0,
      immediateBudget: 0,
    },
  );
  return {
    politicalCapital: state.resources.politicalCapital - held.politicalCapital,
    implementationCapacity:
      state.resources.implementationCapacity - held.implementationCapacity,
    foreignReserves:
      state.economy.stocks.foreignReserves - held.foreignReserves,
    immediateBudget: state.resources.discretionaryBudget - held.immediateBudget,
  };
}

function assertResources(
  state: GameState,
  otherReservations: readonly ResourceReservation[],
  costs: PolicyCosts,
) {
  const free = available(state, otherReservations);
  for (const key of Object.keys(costs) as (keyof PolicyCosts)[]) {
    if (free[key] < costs[key])
      throw new Error(`Insufficient available ${key} for policy reservation`);
  }
}

function requirePreview(draft: PolicyDraft, hash: string) {
  if (draft.status !== "previewed" || draft.previewStateHash !== hash)
    throw new Error("Stale or missing policy preview");
  if (!draft.policyId.trim()) throw new Error("Policy ID is required");
  if (
    draft.quartersAhead < 0 ||
    draft.quartersAhead > 3 ||
    !Number.isInteger(draft.quartersAhead)
  )
    throw new Error("Policy reservation must be within three quarters");
}

function receiptFor(
  command: PolicyCommand,
  quarter: number,
  monthIndex: number,
): PolicyCommandReceipt {
  return {
    commandId: command.commandId,
    fingerprint: canonical(command),
    quarter,
    monthIndex,
    kind: command.kind,
    policyId:
      command.kind === "commit" ? command.draft.policyId : command.policyId,
  };
}

function withReservations(
  state: GameState,
  reservations: readonly ResourceReservation[],
  receipts: readonly PolicyCommandReceipt[],
): GameState {
  const foreignReserves = reservations.reduce(
    (sum, item) => sum + item.costs.foreignReserves,
    0,
  );
  return {
    ...state,
    policyAdministration: { reservations, receipts },
    resources: {
      ...state.resources,
      reservedForeignReserves: stockLevel(foreignReserves),
    },
  };
}

/** Pure, atomic command transition. Persistence must succeed before publishing its result to UI. */
export function applyPolicyCommand(
  state: GameState,
  command: PolicyCommand,
): PolicyCommandResult {
  if (!command.commandId.trim()) throw new Error("Command ID is required");
  const admin = administration(state);
  const prior = admin.receipts.find(
    (entry) => entry.commandId === command.commandId,
  );
  if (prior) {
    if (prior.fingerprint !== canonical(command))
      throw new Error("Command ID payload conflict");
    const meeting = policyMeetingStatus(state);
    return {
      state,
      applied: false,
      slotsRemaining: meeting.slotsRemaining,
      nextPolicyMonth: meeting.nextPolicyMonth,
      causal: [],
    };
  }
  if (state.runState === "completed" || state.runState === "failed")
    throw new Error("Cannot change policy after the game has ended");
  const hash = policyStateHash(state);
  if (command.expectedStateHash !== hash)
    throw new Error("Stale policy draft or game state");
  const meeting = policyMeetingStatus(state);
  if (meeting.slotsRemaining === 0)
    throw new Error("Quarterly policy slots exhausted");
  const receipts = [
    ...admin.receipts,
    receiptFor(command, meeting.quarter, state.monthIndex),
  ];
  let reservations = [...admin.reservations];
  let policies = state.policies;
  const causal: CausalContribution[] = [];
  if (command.kind === "commit") {
    requirePreview(command.draft, hash);
    const id = command.draft.policyId;
    if (
      [
        ...policies.reserved,
        ...policies.active,
        ...policies.completed,
        ...policies.cancelled,
      ].some((policy) => policy.policyId === id)
    )
      throw new Error(`Duplicate policy ID ${id}`);
    const policy = createReservedPolicy(
      state,
      command.draft.ruleId,
      command.draft.value,
      id,
      command.draft.quartersAhead,
    );
    const booked: PolicyDecision = {
      ...policy,
      sourceCommandId: command.commandId,
    };
    assertResources(state, reservations, booked.costs);
    reservations.push({
      reservationId: booked.reservationId ?? id,
      policyId: id,
      costs: booked.costs,
    });
    policies = { ...policies, reserved: [...policies.reserved, booked] };
  } else {
    const old = policies.reserved.find(
      (policy) => policy.policyId === command.policyId,
    );
    if (!old) throw new Error(`No reserved policy ${command.policyId}`);
    reservations = reservations.filter(
      (item) => item.policyId !== old.policyId,
    );
    if (command.kind === "amend") {
      requirePreview(command.draft, hash);
      if (command.draft.policyId !== old.policyId)
        throw new Error("Amendment cannot change policy ID");
      const replacement = createReservedPolicy(
        state,
        command.draft.ruleId,
        command.draft.value,
        old.policyId,
        command.draft.quartersAhead,
      );
      assertResources(state, reservations, replacement.costs);
      reservations.push({
        reservationId: replacement.reservationId ?? old.policyId,
        policyId: old.policyId,
        costs: replacement.costs,
      });
      policies = {
        ...policies,
        reserved: policies.reserved.map((item) =>
          item.policyId === old.policyId
            ? { ...replacement, sourceCommandId: command.commandId }
            : item,
        ),
      };
    } else {
      const rule = policyRules(state.configSnapshot).find(
        (item) => item.policyType === old.type,
      );
      if (!rule) throw new Error(`Unknown policy type ${old.type}`);
      const cost = rule.terminationPoliticalCapital ?? 0;
      if (available(state, reservations).politicalCapital < cost)
        throw new Error("Insufficient cancellation cost");
      const next = state.resources.politicalCapital - cost;
      if (cost > 0)
        causal.push(
          createContributionBuilder(
            "politicalCapital",
            state.economy.institutions.politicalCapital,
          )
            .add(
              {
                sourceType: "policy",
                sourceId: old.policyId,
                labelKey: `policy.${rule.policyId}.cancel`,
                confidence: "high",
              },
              -cost,
            )
            .build(state.economy.institutions.politicalCapital - cost),
        );
      policies = {
        ...policies,
        reserved: policies.reserved.filter(
          (item) => item.policyId !== old.policyId,
        ),
        cancelled: [...policies.cancelled, { ...old, status: "cancelled" }],
      };
      state = {
        ...state,
        resources: { ...state.resources, politicalCapital: scorePoint(next) },
        economy: {
          ...state.economy,
          institutions: {
            ...state.economy.institutions,
            politicalCapital: scorePoint(
              state.economy.institutions.politicalCapital - cost,
            ),
          },
        },
      };
    }
  }
  const next = withReservations({ ...state, policies }, reservations, receipts);
  return {
    state: next,
    applied: true,
    slotsRemaining: meeting.slotsRemaining - 1,
    nextPolicyMonth: meeting.nextPolicyMonth,
    causal,
  };
}

export interface PolicyStateRepository {
  load(slotId: GameState["slotId"]): Promise<GameState | null>;
  /** Reject if the stored state no longer matches expectedStateHash. */
  save(expectedStateHash: string, next: GameState): Promise<void>;
}

/** A UI may show success only after the repository's atomic save resolves. */
export async function submitPolicyCommand(
  repository: PolicyStateRepository,
  slotId: GameState["slotId"],
  command: PolicyCommand,
): Promise<PolicyCommandResult> {
  const state = await repository.load(slotId);
  if (!state) throw new Error(`No saved game in slot ${slotId}`);
  const result = applyPolicyCommand(state, command);
  if (!result.applied) return result;
  try {
    await repository.save(policyStateHash(state), result.state);
    return result;
  } catch (error) {
    const latest = await repository.load(slotId);
    if (latest && policyStateHash(latest) !== policyStateHash(state)) {
      const replay = applyPolicyCommand(latest, command);
      if (!replay.applied) return replay;
    }
    throw error;
  }
}
