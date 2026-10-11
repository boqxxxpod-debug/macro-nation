import { ENGINE_VERSION } from "@macro-nation/simulation-engine";
import { calculateMonth } from "../application/game-service";
import {
  monthRequestSchema,
  type MonthWorkerResponse,
} from "./offline-month-contract";

/** The main thread commits each returned month before requesting the next one. */
self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = monthRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    const requestId = (event.data as { requestId?: unknown } | null)?.requestId;
    if (typeof requestId === "string")
      self.postMessage({
        type: "ERROR",
        requestId,
        engineVersion: ENGINE_VERSION,
        message:
          "時間進行の計算要求を確認できませんでした。ゲームを読み込み直してください。",
      } satisfies MonthWorkerResponse);
    return;
  }
  const request = parsed.data;
  try {
    self.postMessage({
      type: "RESULT",
      requestId: request.requestId,
      engineVersion: ENGINE_VERSION,
      expectedStateHash: request.expectedStateHash,
      state: calculateMonth(request.state, true),
    } satisfies MonthWorkerResponse);
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      requestId: request.requestId,
      engineVersion: ENGINE_VERSION,
      message: error instanceof Error ? error.message : String(error),
    } satisfies MonthWorkerResponse);
  }
};
