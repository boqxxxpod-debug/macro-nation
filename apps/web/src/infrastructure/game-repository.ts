import type { GameState } from "@macro-nation/domain";
import { isMonthlyReportCausalTrace } from "@macro-nation/domain";
import {
  policyStateHash,
  type PolicyStateRepository,
} from "@macro-nation/simulation-engine";
import type { SlotLoadResult } from "../application/game-service";
import {
  emptyScenarioProgression,
  progressionFromStates,
  type ScenarioProgression,
} from "../application/scenario-progression";

const DATABASE = "macro-nation-games";
const STORE = "slots";
const PROFILE_STORE = "profile";
const PROGRESSION_ID = "scenario-progression";

interface ProgressionRecord extends ScenarioProgression {
  readonly id: typeof PROGRESSION_ID;
  readonly schemaVersion: 1;
}

function readProgression(value: unknown): ScenarioProgression {
  if (value === undefined) return emptyScenarioProgression();
  if (!value || typeof value !== "object")
    throw new Error("保存済みのシナリオ解放情報を確認できません");
  const record = value as Partial<ProgressionRecord>;
  if (
    record.id !== PROGRESSION_ID ||
    record.schemaVersion !== 1 ||
    !Array.isArray(record.completedScenarioIds) ||
    record.completedScenarioIds.some((id) => typeof id !== "string")
  )
    throw new Error("保存済みのシナリオ解放情報を確認できません");
  return {
    completedScenarioIds: [...new Set(record.completedScenarioIds)].sort(),
  };
}

function progressionRecord(
  progression: ScenarioProgression,
): ProgressionRecord {
  return { id: PROGRESSION_ID, schemaVersion: 1, ...progression };
}

function sameProgression(
  left: ScenarioProgression,
  right: ScenarioProgression,
): boolean {
  return (
    left.completedScenarioIds.length === right.completedScenarioIds.length &&
    left.completedScenarioIds.every(
      (id, index) => id === right.completedScenarioIds[index],
    )
  );
}

/** Slot and unlock writes share a transaction, including automatic/offline ticks. */
function recordCompletions(
  transaction: IDBTransaction,
  states: readonly GameState[],
  onFailure: (reason: Error) => void,
): void {
  if (!states.some((state) => state.runState === "completed")) return;
  const store = transaction.objectStore(PROFILE_STORE);
  const request = store.get(PROGRESSION_ID);
  request.onsuccess = () => {
    try {
      const previous = readProgression(request.result);
      const next = progressionFromStates(states, previous);
      if (!sameProgression(previous, next)) store.put(progressionRecord(next));
    } catch (error) {
      onFailure(
        error instanceof Error
          ? error
          : new Error("Could not save scenario progression"),
      );
      transaction.abort();
    }
  };
}

interface SlotRecord {
  readonly slotId: GameState["slotId"];
  readonly current: GameState;
  readonly previous?: GameState;
  readonly startCommandId?: string;
}

function isGameState(
  value: unknown,
  slotId: GameState["slotId"],
): value is GameState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<GameState>;
  return (
    state.slotId === slotId &&
    typeof state.gameId === "string" &&
    state.gameId.length > 0 &&
    Number.isSafeInteger(state.monthIndex) &&
    (state.monthIndex ?? -1) >= 0 &&
    typeof state.versions?.saveSchemaVersion === "string" &&
    typeof state.configSnapshot?.configHash === "string" &&
    typeof state.rng === "object" &&
    typeof state.economy === "object" &&
    (state.versions.saveSchemaVersion !== "5" ||
      (Array.isArray(state.history?.reports) &&
        state.history.reports.every((report) =>
          report && isMonthlyReportCausalTrace(report.causalTrace) &&
          (report.causalTrace.completeness !== "initial" || report.monthIndex === 0),
        )))
  );
}

function asRecord(
  value: unknown,
  slotId: GameState["slotId"],
): SlotRecord | null {
  if (!value || typeof value !== "object") return null;
  if ("current" in value) return value as SlotRecord;
  return isGameState(value, slotId) ? { slotId, current: value } : null;
}

/** Transactional slot storage. Every command is visible only after the write commits. */
export class IndexedDbGameRepository implements PolicyStateRepository {
  private readonly factory: IDBFactory;

  constructor(factory: IDBFactory = indexedDB) {
    this.factory = factory;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      // Profile storage is outside GameState: upgrading IndexedDB does not
      // change a run's save schema, model snapshot, seed, or economic values.
      const request = this.factory.open(DATABASE, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: "slotId" });
        if (!request.result.objectStoreNames.contains(PROFILE_STORE))
          request.result.createObjectStore(PROFILE_STORE, { keyPath: "id" });
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open save database"));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async load(slotId: GameState["slotId"]): Promise<GameState | null> {
    return (await this.loadSlot(slotId)).state;
  }

  /** Backfill completed pre-profile saves without modifying their run data. */
  async loadProgression(): Promise<ScenarioProgression> {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          [STORE, PROFILE_STORE],
          "readwrite",
        );
        const profileStore = transaction.objectStore(PROFILE_STORE);
        const profileRequest = profileStore.get(PROGRESSION_ID);
        const slotsRequest = transaction.objectStore(STORE).getAll();
        let result = emptyScenarioProgression();
        let profileLoaded = false;
        let slotsLoaded = false;
        let reason: Error | null = null;
        const merge = () => {
          if (!profileLoaded || !slotsLoaded) return;
          try {
            const states: GameState[] = [];
            for (const value of slotsRequest.result as unknown[]) {
              if (!value || typeof value !== "object") continue;
              const slotId = (value as Partial<SlotRecord>).slotId;
              if (slotId !== 1 && slotId !== 2 && slotId !== 3) continue;
              const record = asRecord(value, slotId);
              // Match loadSlot's recovery rule; invalid current data cannot
              // grant completion and a valid previous generation can recover.
              const state = isGameState(record?.current, slotId)
                ? record.current
                : isGameState(record?.previous, slotId)
                  ? record.previous
                  : null;
              if (state) states.push(state);
            }
            const previous = readProgression(profileRequest.result);
            result = progressionFromStates(states, previous);
            if (
              profileRequest.result === undefined ||
              !sameProgression(previous, result)
            )
              profileStore.put(progressionRecord(result));
          } catch (error) {
            reason =
              error instanceof Error
                ? error
                : new Error("Could not read scenario progression");
            transaction.abort();
          }
        };
        profileRequest.onsuccess = () => {
          profileLoaded = true;
          merge();
        };
        slotsRequest.onsuccess = () => {
          slotsLoaded = true;
          merge();
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () =>
          reject(
            reason ??
              transaction.error ??
              new Error("Could not read scenario progression"),
          );
        transaction.onerror = () =>
          reject(
            transaction.error ??
              new Error("Could not read scenario progression"),
          );
      });
    } finally {
      database.close();
    }
  }

  async loadSlot(slotId: GameState["slotId"]): Promise<SlotLoadResult> {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, "readonly");
        const request = transaction.objectStore(STORE).get(slotId);
        let found: SlotLoadResult = { state: null, recovered: false };
        request.onsuccess = () => {
          const record = asRecord(request.result, slotId);
          if (!record) return;
          if (isGameState(record.current, slotId)) {
            found = {
              state: structuredClone(record.current),
              recovered: false,
            };
          } else if (isGameState(record.previous, slotId)) {
            found = {
              state: structuredClone(record.previous),
              recovered: true,
              reason:
                "最新の保存データを読み込めなかったため、直前の保存から読み込みました。進んだ月や政策を確認しましょう。",
            };
          } else {
            found = {
              state: null,
              recovered: false,
              reason:
                "最新と直前の保存データを確認できませんでした。別の保存先から続けるか、新しく始めることができます。",
            };
          }
        };
        transaction.oncomplete = () => resolve(found);
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Could not read saved game"));
      });
    } finally {
      database.close();
    }
  }

  async save(
    expectedStateHash: string,
    next: GameState,
    shouldCommit?: () => boolean,
  ): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [STORE, PROFILE_STORE],
          "readwrite",
        );
        const store = transaction.objectStore(STORE);
        const request = store.get(next.slotId);
        let reason: Error | null = null;
        request.onsuccess = () => {
          if (shouldCommit?.() === false) {
            reason = new Error("保存前にゲームが切り替わりました");
            transaction.abort();
            return;
          }
          const record = asRecord(request.result, next.slotId);
          const current = isGameState(record?.current, next.slotId)
            ? record.current
            : isGameState(record?.previous, next.slotId)
              ? record.previous
              : undefined;
          if (!current || policyStateHash(current) !== expectedStateHash) {
            reason = new Error("Saved game changed before policy confirmation");
            transaction.abort();
            return;
          }
          store.put({
            slotId: next.slotId,
            current: next,
            previous: current,
            ...(record?.startCommandId
              ? { startCommandId: record.startCommandId }
              : {}),
          } satisfies SlotRecord);
          recordCompletions(transaction, [current, next], (error) => {
            reason = error;
          });
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(
            reason ?? transaction.error ?? new Error("Could not save game"),
          );
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Could not save game"));
      });
    } finally {
      database.close();
    }
  }

  async create(state: GameState, startCommandId?: string): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [STORE, PROFILE_STORE],
          "readwrite",
        );
        const store = transaction.objectStore(STORE);
        const request = store.get(state.slotId);
        let reason: Error | null = null;
        request.onsuccess = () => {
          const record = asRecord(request.result, state.slotId);
          if (
            record?.startCommandId &&
            record.startCommandId === startCommandId
          )
            return;
          if (record) {
            reason = new Error("Save slot already exists");
            transaction.abort();
            return;
          }
          store.add({
            slotId: state.slotId,
            current: state,
            ...(startCommandId ? { startCommandId } : {}),
          } satisfies SlotRecord);
          recordCompletions(transaction, [state], (error) => {
            reason = error;
          });
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(
            reason ??
              transaction.error ??
              new Error("Save slot already exists"),
          );
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Could not create save"));
      });
    } finally {
      database.close();
    }
  }

  async delete(slotId: GameState["slotId"]): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [STORE, PROFILE_STORE],
          "readwrite",
        );
        const store = transaction.objectStore(STORE);
        const request = store.get(slotId);
        let reason: Error | null = null;
        request.onsuccess = () => {
          const record = asRecord(request.result, slotId);
          const current = isGameState(record?.current, slotId)
            ? record.current
            : isGameState(record?.previous, slotId)
              ? record.previous
              : null;
          // A pre-profile completed save can be removed before progression is
          // first loaded. Preserve its earned unlock in this same transaction.
          if (current)
            recordCompletions(transaction, [current], (error) => {
              reason = error;
            });
          store.delete(slotId);
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(
            reason ?? transaction.error ?? new Error("Could not delete save"),
          );
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Could not delete save"));
      });
    } finally {
      database.close();
    }
  }
}
