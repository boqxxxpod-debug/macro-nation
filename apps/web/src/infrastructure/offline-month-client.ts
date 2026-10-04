import type { GameState } from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  policyStateHash,
} from "@macro-nation/simulation-engine";
import {
  monthResponseSchema,
  type MonthWorkerRequest,
} from "./offline-month-contract";

type WorkerPort = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror"
>;

export interface AutomaticMonthClient {
  calculate(state: GameState): Promise<GameState>;
  cancel(): void;
}

/** One Worker per batch; every request starts from the latest durable month. */
export class OfflineMonthClient implements AutomaticMonthClient {
  private sequence = 0;
  private worker: WorkerPort | null = null;
  private pending: { reject(error: Error): void } | null = null;

  constructor(
    private readonly createWorker: () => WorkerPort = () => {
      if (typeof Worker === "undefined")
        throw new Error(
          "自動進行の計算機能を利用できません。手動モードで続けることができます。",
        );
      return new Worker(new URL("./offline-month.worker.ts", import.meta.url), {
        type: "module",
      });
    },
  ) {}

  cancel(): void {
    this.sequence += 1;
    this.worker?.terminate();
    this.worker = null;
    this.pending?.reject(new Error("時間進行の計算を中止しました"));
    this.pending = null;
  }

  calculate(state: GameState): Promise<GameState> {
    if (this.pending)
      return Promise.reject(new Error("時間進行は順番に計算してください"));
    const requestId = String(++this.sequence);
    const expectedStateHash = policyStateHash(state);
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        if (requestId !== String(this.sequence)) return;
        this.worker?.terminate();
        this.worker = null;
        this.pending = null;
        reject(error);
      };
      try {
        const worker = this.worker ?? this.createWorker();
        this.worker = worker;
        this.pending = { reject };
        worker.onerror = () =>
          fail(
            new Error(
              "自動進行の計算が中断されました。最後に保存した月から再開できます。",
            ),
          );
        worker.onmessageerror = () =>
          fail(new Error("自動進行の計算結果を読み込めませんでした。"));
        worker.onmessage = (event: MessageEvent<unknown>) => {
          if (requestId !== String(this.sequence)) return;
          const parsed = monthResponseSchema.safeParse(event.data);
          if (!parsed.success || parsed.data.requestId !== requestId) {
            fail(new Error("時間進行の計算結果が現在のゲームと一致しません。"));
            return;
          }
          const response = parsed.data;
          if (response.type === "ERROR") {
            fail(new Error(response.message));
            return;
          }
          const next = response.state;
          if (
            response.expectedStateHash !== expectedStateHash ||
            next.gameId !== state.gameId ||
            next.slotId !== state.slotId ||
            next.tickSequence !== state.tickSequence + 1 ||
            next.monthIndex !== state.monthIndex + 1
          ) {
            fail(new Error("時間進行の計算結果が現在のゲームと一致しません。"));
            return;
          }
          this.pending = null;
          resolve(next);
        };
        worker.postMessage({
          type: "CALCULATE_MONTH",
          requestId,
          engineVersion: ENGINE_VERSION,
          expectedStateHash,
          expectedTick: state.tickSequence,
          state,
        } satisfies MonthWorkerRequest);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
