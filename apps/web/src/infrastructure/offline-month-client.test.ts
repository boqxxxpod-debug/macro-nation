import { beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { ENGINE_VERSION } from "@macro-nation/simulation-engine";
import {
  calculateMonth,
  createGame,
  type GameRepository,
} from "../application/game-service";
import { OfflineMonthClient } from "./offline-month-client";
import {
  monthRequestSchema,
  type MonthWorkerRequest,
} from "./offline-month-contract";

let initial: GameState;
beforeAll(async () => {
  let saved: GameState | null = null;
  const repository: GameRepository = {
    async load() {
      return saved;
    },
    async create(state) {
      saved = state;
    },
    async save(_expected, state) {
      saved = state;
    },
  };
  const created = await createGame(repository, "baseline-96", 1, "casual");
  initial = {
    ...created,
    runState: "running",
    pendingOfflineSteps: 2,
    clock: {
      ...created.clock,
      progressionMode: "auto",
      lastProcessedWallClockMs: 1_000,
    },
  };
});

function fakeWorker() {
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as (() => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn<(request: MonthWorkerRequest) => void>(),
    terminate: vi.fn(),
  };
  return worker;
}

function response(request: MonthWorkerRequest) {
  return {
    type: "RESULT",
    requestId: request.requestId,
    engineVersion: ENGINE_VERSION,
    expectedStateHash: request.expectedStateHash,
    state: calculateMonth(request.state, true),
  };
}

describe("automatic month Worker boundary", () => {
  it("reuses a batch Worker and calculates the same two durable monthly outcomes", async () => {
    const worker = fakeWorker();
    const createWorker = vi.fn(() => worker as unknown as Worker);
    const client = new OfflineMonthClient(createWorker);
    const first = client.calculate(initial);
    const firstRequest = worker.postMessage.mock.calls[0]![0];
    expect(monthRequestSchema.safeParse(firstRequest).success).toBe(true);
    worker.onmessage?.({ data: response(firstRequest) } as MessageEvent);
    const firstState = await first;
    expect(firstState).toEqual(calculateMonth(initial, true));
    const second = client.calculate(firstState);
    const secondRequest = worker.postMessage.mock.calls[1]![0];
    worker.onmessage?.({ data: response(secondRequest) } as MessageEvent);
    expect(await second).toEqual(calculateMonth(firstState, true));
    expect(createWorker).toHaveBeenCalledOnce();
    client.cancel();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(["request", "hash", "slot", "tick", "version", "invalidState"])(
    "rejects a %s mismatch before a candidate can be saved",
    async (kind) => {
      const worker = fakeWorker();
      const client = new OfflineMonthClient(() => worker as unknown as Worker);
      const pending = client.calculate(initial);
      const request = worker.postMessage.mock.calls[0]![0];
      const valid = response(request);
      const bad =
        kind === "request"
          ? { ...valid, requestId: "old" }
          : kind === "hash"
            ? { ...valid, expectedStateHash: "old" }
            : kind === "slot"
              ? { ...valid, state: { ...valid.state, slotId: 2 } }
              : kind === "tick"
                ? { ...valid, state: initial }
                : kind === "version"
                  ? { ...valid, engineVersion: "old" }
                  : {
                      ...valid,
                      state: {
                        ...valid.state,
                        economy: {
                          ...valid.state.economy,
                          sentiment: {
                            ...valid.state.economy.sentiment,
                            support: Number.NaN,
                          },
                        },
                      },
                    };
      worker.onmessage?.({ data: bad } as MessageEvent);
      await expect(pending).rejects.toThrow(/一致/);
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );

  it("cancels immediately, ignores the old response, and recreates the Worker after a crash", async () => {
    const workers = [fakeWorker(), fakeWorker(), fakeWorker()];
    let workerIndex = 0;
    const factory = vi.fn(() => workers[workerIndex++] as unknown as Worker);
    const client = new OfflineMonthClient(factory);
    const cancelled = client.calculate(initial);
    const oldRequest = workers[0]!.postMessage.mock.calls[0]![0];
    client.cancel();
    await expect(cancelled).rejects.toThrow(/中止/);
    const crashed = client.calculate(initial);
    workers[0]!.onmessage?.({ data: response(oldRequest) } as MessageEvent);
    workers[1]!.onerror?.();
    await expect(crashed).rejects.toThrow(/中断/);
    const restarted = client.calculate(initial);
    const request = workers[2]!.postMessage.mock.calls[0]![0];
    workers[2]!.onmessage?.({ data: response(request) } as MessageEvent);
    expect((await restarted).monthIndex).toBe(1);
    expect(factory).toHaveBeenCalledTimes(3);
    client.cancel();
  });

  it("rejects malformed or mismatched requests at the Worker input boundary", () => {
    expect(monthRequestSchema.safeParse({}).success).toBe(false);
    expect(
      monthRequestSchema.safeParse({
        type: "CALCULATE_MONTH",
        requestId: "1",
        engineVersion: ENGINE_VERSION,
        expectedStateHash: "stale",
        expectedTick: 0,
        state: initial,
      }).success,
    ).toBe(false);
  });
});
