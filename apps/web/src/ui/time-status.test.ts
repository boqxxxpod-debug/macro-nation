import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ClockStopReason, GameState } from "@macro-nation/domain";
import { createGame } from "../application/game-service";
import { clockStatus } from "./time-status";

let initial: GameState;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "issue-106-time-status",
    1,
    "casual",
  );
});

describe("saved clock status", () => {
  it("shows progress only when automatic time is running", () => {
    const state: GameState = {
      ...initial,
      runState: "running",
      clock: { ...initial.clock, progressionMode: "auto" },
    };
    expect(clockStatus(state)).toBe("進行中");
    expect(
      clockStatus({
        ...state,
        clock: { ...state.clock, warning: "CLOCK_MOVED_BACKWARD" },
      }),
    ).toBe("時刻の調整待ち");
    expect(clockStatus({ ...state, runState: "paused" })).toBe(
      "停止中 · 操作待ち",
    );
  });

  it.each(["manual", undefined] as const)(
    "keeps a %s-mode running save stopped and ignores stale clock warnings",
    (progressionMode) => {
      const clock = {
        ...initial.clock,
        warning: "CLOCK_MOVED_BACKWARD" as const,
      };
      if (progressionMode === undefined) delete clock.progressionMode;
      else clock.progressionMode = progressionMode;
      expect(
        clockStatus({
          ...initial,
          runState: "running",
          clock,
        }),
      ).toBe("停止中 · 操作待ち");
    },
  );

  it("shows calculation and save activity in either progression mode", () => {
    expect(clockStatus({ ...initial, runState: "calculating" })).toBe(
      "計算・保存中",
    );
    const automatic: GameState = {
      ...initial,
      runState: "running",
      clock: { ...initial.clock, progressionMode: "auto" },
    };
    expect(clockStatus(automatic, true)).toBe("計算・保存中");
    expect(clockStatus(initial, true)).toBe("計算・保存中");
  });

  it.each([
    ["manual", "操作待ち"],
    ["policy", "政策会議で停止"],
    ["event", "イベントの選択待ち"],
    ["crisis", "危機への対応待ち"],
    ["error", "計算・保存エラー"],
    ["completed", "予定期間を終了"],
    ["failed", "危機で終了"],
    ["offlineLimit", "残りの進行があります"],
    ["tutorial", "説明を確認中"],
  ] satisfies readonly (readonly [ClockStopReason, string])[])(
    "restores the saved %s stop reason without changing the save",
    (stopReason, label) => {
      const state: GameState = {
        ...initial,
        clock: { ...initial.clock, stopReason },
      };
      const saved = JSON.stringify(state);
      const restored = JSON.parse(saved) as GameState;
      expect(clockStatus(restored)).toBe(`停止中 · ${label}`);
      expect(JSON.stringify(restored)).toBe(saved);
    },
  );

  it.each([
    ["awaitingEvent", "イベントの選択待ち"],
    ["crisisStopped", "危機への対応待ち"],
    ["completed", "予定期間を終了"],
    ["failed", "危機で終了"],
  ] as const)(
    "uses %s instead of a stale saved stop reason",
    (runState, label) => {
      expect(
        clockStatus({
          ...initial,
          runState,
          clock: {
            ...initial.clock,
            progressionMode: "auto",
            stopReason: "policy",
            warning: "CLOCK_MOVED_BACKWARD",
          },
        }),
      ).toBe(`停止中 · ${label}`);
    },
  );

  it("falls back to waiting for an operation when an old paused save has no stop reason", () => {
    const clock = { ...initial.clock };
    delete clock.progressionMode;
    delete clock.stopReason;
    expect(clockStatus({ ...initial, clock })).toBe("停止中 · 操作待ち");
  });
});
