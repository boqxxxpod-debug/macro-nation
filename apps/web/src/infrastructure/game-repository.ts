import type { GameState } from "@macro-nation/domain";
import {
  policyStateHash,
  type PolicyStateRepository,
} from "@macro-nation/simulation-engine";

const DATABASE = "macro-nation-games";
const STORE = "slots";

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
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, "readonly");
        const request = transaction.objectStore(STORE).get(slotId);
        let found: GameState | null = null;
        request.onsuccess = () => {
          found = (request.result as GameState | undefined) ?? null;
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
          const stored = request.result as GameState | undefined;
          if (!stored || policyStateHash(stored) !== expectedStateHash) {
            reason = new Error("Saved game changed before policy confirmation");
            transaction.abort();
            return;
          }
          store.put(next);
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

  async create(state: GameState): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).add(state);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("Save slot already exists"));
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
