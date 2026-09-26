import type { GameState } from "@macro-nation/domain";
import {
  policyStateHash,
  type PolicyStateRepository,
} from "@macro-nation/simulation-engine";
import type { SlotLoadResult } from "../application/game-service";

const DATABASE = "macro-nation-games";
const STORE = "slots";

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
    typeof state.economy === "object"
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
      const request = this.factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: "slotId" });
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open save database"));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async load(slotId: GameState["slotId"]): Promise<GameState | null> {
    return (await this.loadSlot(slotId)).state;
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
                "現在の保存データが破損していたため、直前の正常な保存から復旧しました。",
            };
          } else {
            found = {
              state: null,
              recovered: false,
              reason: "現在と直前の保存データを検証できませんでした。",
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

  async save(expectedStateHash: string, next: GameState): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        const request = store.get(next.slotId);
        let reason: Error | null = null;
        request.onsuccess = () => {
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
        const transaction = database.transaction(STORE, "readwrite");
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
        const transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).delete(slotId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("Could not delete save"));
      });
    } finally {
      database.close();
    }
  }
}
