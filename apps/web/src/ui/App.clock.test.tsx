import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { createGame, type GameRepository } from "../application/game-service";
import { policyStateHash } from "../application/policy-view";
import { App } from "./App";

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

function memoryRepository() {
  const slots = new Map<number, GameState>();
  let blockedSave: Promise<void> | null = null;
  let fail = false;
  let attempts = 0;
  const repository: GameRepository = {
    async load(slotId) {
      return slots.has(slotId) ? structuredClone(slots.get(slotId)!) : null;
    },
    async create(state) {
      slots.set(state.slotId, structuredClone(state));
    },
    async save(expected, next) {
      attempts += 1;
      const pending = blockedSave;
      blockedSave = null;
      if (pending) await pending;
      if (fail) throw new Error("storage unavailable");
      const saved = slots.get(next.slotId);
      if (!saved || policyStateHash(saved) !== expected)
        throw new Error("stale state");
      slots.set(next.slotId, structuredClone(next));
    },
  };
  return {
    repository,
    slots,
    get attempts() {
      return attempts;
    },
    failSave() {
      fail = true;
    },
    holdSave() {
      let release!: () => void;
      blockedSave = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}
async function autoMode() {
  await act(async () => {
    fireEvent.change(screen.getByRole("combobox", { name: "時間の進め方" }), {
      target: { value: "auto" },
    });
  });
}

describe("game clock UI", () => {
  it("keeps tutorial progression manual until its configured introductory period ends", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "first-playable-48");
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => 0} />);
    });
    await autoMode();
    expect(
      screen.getByRole("button", { name: "自動進行を始める" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "時間の進行" }),
    ).toHaveTextContent("はじめの12か月");
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "時間の進め方" }), {
        target: { value: "manual" },
      });
    });
    await click("1か月進める");
    expect(memory.slots.get(1)?.monthIndex).toBe(1);
  });

  it("requires an explicit start and preserves its clock and focus across viewing routes", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "first-playable-48", 1, "casual");
    let now = 0;
    vi.useFakeTimers();
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => now} />);
    });
    now += 900_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
    await autoMode();
    now += 300_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(memory.slots.get(1)?.runState).toBe("paused");
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
    await click("自動進行を始める");
    expect(screen.getByRole("button", { name: "1か月進める" })).toBeDisabled();
    now += 120_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByLabelText("次の月までの残り時間")).toHaveTextContent(
      "あと 3:00",
    );
    await click("国家の景観を見る");
    const pause = screen.getByRole("button", { name: "一時停止" });
    pause.focus();
    now += 180_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(memory.slots.get(1)?.monthIndex).toBe(1);
    expect(
      within(screen.getByRole("region", { name: "時間の進行" })).getByText(
        "1年目 2月",
      ),
    ).toBeInTheDocument();
    expect(pause).toHaveFocus();
    await click("一時停止");
    now += 600_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(memory.slots.get(1)?.monthIndex).toBe(1);
    expect(screen.getByRole("button", { name: "再開" })).toBeEnabled();
  });

  it("waits for a durable pause before opening policy and does not resume on close", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "first-playable-48", 1, "casual");
    let now = 0;
    vi.useFakeTimers();
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => now} />);
    });
    await autoMode();
    await click("自動進行を始める");
    const release = memory.holdSave();
    await click("政策を考える");
    expect(
      screen.getByRole("heading", { name: "国家ホーム" }),
    ).toBeInTheDocument();
    expect(memory.slots.get(1)?.runState).toBe("running");
    await act(async () => {
      release();
    });
    expect(window.location.pathname).toBe("/game/1/policies");
    expect(
      screen.getByRole("button", { name: "1年・5年を比較する" }),
    ).toBeEnabled();
    expect(memory.slots.get(1)?.clock.stopReason).toBe("policy");
    now += 600_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await click("ホーム");
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
    expect(screen.getByRole("button", { name: "再開" })).toBeEnabled();
    await click("再開");
    now += 300_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(memory.slots.get(1)?.monthIndex).toBe(1);
  });

  it("restores the slot named in the URL and reports its offline update", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "another-slot", 1, "casual");
    const saved = await createGame(
      memory.repository,
      "first-playable-48",
      2,
      "casual",
    );
    memory.slots.set(2, {
      ...saved,
      runState: "running",
      clock: {
        ...saved.clock,
        progressionMode: "auto",
        lastProcessedWallClockMs: 0,
      },
    });
    window.history.replaceState({}, "", "/game/2/nation");
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => 300_000} />);
    });
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
    expect(memory.slots.get(2)?.monthIndex).toBe(1);
    expect(screen.getByRole("region", { name: "帰還報告" })).toHaveTextContent(
      "1か月を反映しました",
    );
    await click("経済レポートで理由を見る");
    expect(window.location.pathname).toBe("/game/2/report");
  });

  it("reconciles a hidden auto run once and excludes time spent paused", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "first-playable-48", 1, "casual");
    let now = 0;
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      visibility.mockReturnValue("visible");
      await act(async () => {
        render(<App repository={memory.repository} nowMs={() => now} />);
      });
      await autoMode();
      await click("自動進行を始める");
      now += 120_000;
      visibility.mockReturnValue("hidden");
      await act(async () => {
        fireEvent(document, new Event("visibilitychange"));
      });
      now += 480_000;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(memory.slots.get(1)?.monthIndex).toBe(0);
      visibility.mockReturnValue("visible");
      await act(async () => {
        fireEvent(document, new Event("visibilitychange"));
      });
      expect(memory.slots.get(1)?.monthIndex).toBe(2);
      expect(
        screen.getByRole("region", { name: "帰還報告" }),
      ).toHaveTextContent("2か月を反映しました");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(memory.slots.get(1)?.monthIndex).toBe(2);
      await click("一時停止");
      visibility.mockReturnValue("hidden");
      await act(async () => {
        fireEvent(document, new Event("visibilitychange"));
      });
      now += 900_000;
      visibility.mockReturnValue("visible");
      await act(async () => {
        fireEvent(document, new Event("visibilitychange"));
      });
      expect(memory.slots.get(1)?.monthIndex).toBe(2);
    } finally {
      visibility.mockRestore();
    }
  });

  it("returns a direct policy reload to home when its pause cannot be saved", async () => {
    const memory = memoryRepository();
    const saved = await createGame(
      memory.repository,
      "first-playable-48",
      1,
      "casual",
    );
    memory.slots.set(1, {
      ...saved,
      runState: "running",
      clock: {
        ...saved.clock,
        progressionMode: "auto",
        lastProcessedWallClockMs: 0,
      },
    });
    memory.failSave();
    window.history.replaceState({}, "", "/game/1/policies");
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => 600_000} />);
    });
    expect(
      screen.getByRole("heading", { name: "国家ホーム" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "1年・5年を比較する" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("storage unavailable");
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
    expect(window.location.pathname).toBe("/game/1");
  });

  it("stops after a failed save and leaves later timer calls idle", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "first-playable-48", 1, "casual");
    let now = 0;
    vi.useFakeTimers();
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => now} />);
    });
    await autoMode();
    await click("自動進行を始める");
    memory.failSave();
    now += 300_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("storage unavailable");
    expect(
      screen.getByRole("region", { name: "時間の進行" }),
    ).toHaveTextContent("計算・保存エラー");
    const attempts = memory.attempts;
    now += 900_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(memory.attempts).toBe(attempts);
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
  });
});
