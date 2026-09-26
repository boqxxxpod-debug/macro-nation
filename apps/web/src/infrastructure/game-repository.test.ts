import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { policyStateHash } from "@macro-nation/simulation-engine";
import { createGame } from "../application/game-service";
import { IndexedDbGameRepository } from "./game-repository";

async function replaceCurrentWithCorrupt(factory: IDBFactory) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("macro-nation-games", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("slots", "readwrite");
    const store = transaction.objectStore("slots");
    const request = store.get(1);
    request.onsuccess = () =>
      store.put({ ...request.result, current: { slotId: 1 } });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

describe("IndexedDbGameRepository generations", () => {
  it("keeps start commands idempotent and recovers a corrupt current generation", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    const initial = await createGame(
      repository,
      "recoverable",
      1,
      "learning",
      "long",
      "standard",
      "start-command-1",
    );
    await repository.save(policyStateHash(initial), {
      ...initial,
      learningMode: "standard",
    });
    await expect(
      repository.create(initial, "start-command-1"),
    ).resolves.toBeUndefined();
    expect((await repository.load(1))?.gameId).toBe(initial.gameId);
    await expect(
      repository.create({ ...initial, gameId: "different" }, "new-command"),
    ).rejects.toThrow(/exists/);

    await replaceCurrentWithCorrupt(factory);
    const recovered = await repository.loadSlot(1);
    expect(recovered.recovered).toBe(true);
    expect(recovered.reason).toMatch(/破損.*直前/);
    expect(recovered.state?.durationMode).toBe("long");
    expect(recovered.state?.difficulty).toBe("standard");
  });
});
