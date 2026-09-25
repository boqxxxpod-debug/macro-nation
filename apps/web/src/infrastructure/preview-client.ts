import {
  ENGINE_VERSION,
  policyDraftHash,
  policyStateHash,
  previewCacheKey,
  previewPolicy,
  type PreviewInput,
  type PreviewOutput,
} from "@macro-nation/simulation-engine";

type PreviewResponse =
  | {
      readonly type: "RESULT";
      readonly requestId: string;
      readonly draftHash: string;
      readonly stateHash: string;
      readonly payload: PreviewOutput;
    }
  | {
      readonly type: "ERROR";
      readonly requestId: string;
      readonly message: string;
    };

type WorkerPort = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror"
>;

/** Worker is disposable per request, so termination cancels even a synchronous model run. */
export class PreviewClient {
  private sequence = 0;
  private pending: { reject(error: Error): void; worker?: WorkerPort } | null =
    null;
  private readonly cache = new Map<string, PreviewOutput>();

  constructor(
    private readonly createWorker: (() => WorkerPort) | null = typeof Worker ===
    "undefined"
      ? null
      : () =>
          new Worker(new URL("./preview.worker.ts", import.meta.url), {
            type: "module",
          }),
    private readonly compute: (
      input: PreviewInput,
    ) => PreviewOutput = previewPolicy,
  ) {}

  cancel(): void {
    this.sequence += 1;
    this.pending?.worker?.terminate();
    this.pending?.reject(new Error("Preview cancelled"));
    this.pending = null;
  }

  request(input: PreviewInput): Promise<PreviewOutput> {
    this.cancel();
    const key = previewCacheKey(input);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    const requestId = String(this.sequence);
    const draftHash = policyDraftHash(input.draft);
    const stateHash = policyStateHash(input.state);
    return new Promise((resolve, reject) => {
      const worker = this.createWorker?.();
      const finish = (result: PreviewOutput) => {
        if (requestId !== String(this.sequence)) return;
        worker?.terminate();
        this.pending = null;
        this.cache.set(key, result);
        if (this.cache.size > 16)
          this.cache.delete(this.cache.keys().next().value!);
        resolve(result);
      };
      const fail = (error: Error) => {
        if (requestId !== String(this.sequence)) return;
        worker?.terminate();
        this.pending = null;
        reject(error);
      };
      this.pending = { reject, ...(worker && { worker }) };
      if (!worker) {
        queueMicrotask(() => {
          if (requestId !== String(this.sequence)) return;
          try {
            finish(this.compute(input));
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
        return;
      }
      worker.onmessage = (event: MessageEvent<PreviewResponse>) => {
        const response = event.data;
        if (requestId !== String(this.sequence)) return;
        if (response?.requestId !== requestId) {
          fail(new Error("Stale preview response"));
        } else if (response.type === "ERROR") {
          fail(new Error(response.message));
        } else if (
          response.type !== "RESULT" ||
          response.draftHash !== draftHash ||
          response.stateHash !== stateHash ||
          response.payload.cacheKey !== key ||
          response.payload.engineVersion !== ENGINE_VERSION
        ) {
          fail(new Error("Stale preview response"));
        } else {
          finish(response.payload);
        }
      };
      worker.onerror = () => fail(new Error("Policy preview worker failed"));
      try {
        worker.postMessage({
          type: "PREVIEW_POLICY",
          requestId,
          engineVersion: ENGINE_VERSION,
          input,
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
