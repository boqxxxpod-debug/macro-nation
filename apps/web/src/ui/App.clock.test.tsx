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
import {
  calculateMonth,
  confirmPolicy,
  createGame,
  type GameRepository,
} from "../application/game-service";
import { policyStateHash } from "../application/policy-view";
import { App } from "./App";
import { OfflineMonthClient } from "../infrastructure/offline-month-client";

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(OfflineMonthClient.prototype, "calculate").mockImplementation(
    async (state) => calculateMonth(state, true),
  );
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

async function savedConfirmedPolicy(
  repository: GameRepository,
  progressionMode: "manual" | "auto",
) {
  const initial = await createGame(
    repository,
    "first-playable-48",
    1,
    "casual",
  );
  const paused: GameState = {
    ...initial,
    clock: { ...initial.clock, progressionMode, stopReason: "policy" },
  };
  await repository.save(policyStateHash(initial), paused);
  const stateHash = policyStateHash(paused);
  return confirmPolicy(repository, 1, {
    kind: "commit",
    commandId: "confirmed-rate-command",
    expectedStateHash: stateHash,
    draft: {
      status: "previewed",
      policyId: "confirmed-rate-policy",
      ruleId: "interest-rate",
      value: 0.05,
      quartersAhead: 0,
      previewStateHash: stateHash,
    },
  });
}

describe("game clock UI", () => {
  it("restores a confirmed policy with its human-readable setting and manual next step", async () => {
    const memory = memoryRepository();
    const confirmed = await savedConfirmedPolicy(memory.repository, "manual");
    let now = 900_000;
    vi.useFakeTimers();
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => now} />);
    });
    expect(screen.getByRole("combobox", { name: "ホームの詳細" })).toHaveValue(
      "policy",
    );
    const policy = screen.getByLabelText("確定した政策の内容");
    expect(policy).toHaveTextContent("政策金利（年率・%）：5%");
    expect(policy).toHaveTextContent("開始予定：1月目");
    expect(policy).toHaveTextContent("状態：開始待ち（予約中）");
    expect(policy).toHaveTextContent("確定した時点では発動していません");
    expect(policy).toHaveTextContent("「1か月進める」で月を進めてください。");
    expect(
      screen.getByRole("region", { name: "時間の進行" }),
    ).toHaveTextContent("停止中 · 政策会議で停止");
    now += 600_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await click("政策会議");
    expect(document.querySelector(".game-view > .eyebrow")).toHaveTextContent(
      "手動・停止中 · 政策会議で停止",
    );
    await click("レポート");
    expect(document.querySelector(".game-view > .eyebrow")).toHaveTextContent(
      "手動・停止中 · 政策会議で停止",
    );
    expect(memory.slots.get(1)?.monthIndex).toBe(confirmed.monthIndex);
    expect(memory.slots.get(1)?.policies).toEqual(confirmed.policies);
    await click("ホーム");
    await click("1か月進める");
    expect(memory.slots.get(1)?.monthIndex).toBe(1);
    expect(memory.slots.get(1)?.policies.reserved).toHaveLength(0);
    expect(memory.slots.get(1)?.policies.active).toHaveLength(1);
    expect(memory.slots.get(1)?.policyAdministration?.receipts).toHaveLength(1);
    const activePolicy = screen.getByLabelText("確定した政策の内容");
    expect(activePolicy).toHaveTextContent("政策金利（年率・%）：5%");
    expect(activePolicy).toHaveTextContent("開始月：1月目。状態：実施中");
    expect(activePolicy).toHaveTextContent(
      "開始と効果が表れる時期には時間差があります",
    );
    await click("レポートで結果を見る");
    expect(window.location.pathname).toBe("/game/1/report");
    expect(
      screen.getByRole("heading", { name: "経済レポート" }),
    ).toBeInTheDocument();
  });

  it("keeps a confirmed auto policy paused across reload until explicit resume activates it once", async () => {
    const memory = memoryRepository();
    const confirmed = await savedConfirmedPolicy(memory.repository, "auto");
    let now = 900_000;
    vi.useFakeTimers();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<App repository={memory.repository} nowMs={() => now} />);
    });
    const policy = screen.getByLabelText("確定した政策の内容");
    expect(policy).toHaveTextContent("状態：開始待ち（予約中）");
    expect(policy).toHaveTextContent("時間の進行で「再開」");
    expect(policy).toHaveTextContent("政策の確定や再読込だけでは進みません");
    const pausedWrites = memory.attempts;
    now += 600_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await click("政策会議");
    await click("レポート");
    expect(document.querySelector(".game-view > .eyebrow")).toHaveTextContent(
      "自動・停止中 · 政策会議で停止",
    );
    await click("ホーム");
    view.unmount();
    now += 900_000;
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => now} />);
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      screen.getByRole("region", { name: "時間の進行" }),
    ).toHaveTextContent("停止中 · 政策会議で停止");
    expect(screen.getByRole("button", { name: "再開" })).toBeEnabled();
    expect(memory.slots.get(1)).toEqual(confirmed);
    expect(memory.attempts).toBe(pausedWrites);
    await click("再開");
    expect(memory.slots.get(1)?.runState).toBe("running");
    expect(memory.slots.get(1)?.clock.lastProcessedWallClockMs).toBe(now);
    now += 299_999;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
    now += 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(memory.slots.get(1)?.monthIndex).toBe(1);
    expect(memory.slots.get(1)?.policies.reserved).toHaveLength(0);
    expect(memory.slots.get(1)?.policies.active).toEqual([
      expect.objectContaining({
        policyId: "confirmed-rate-policy",
        status: "active",
        inputs: { value: 0.05 },
      }),
    ]);
    expect(memory.slots.get(1)?.policyAdministration?.receipts).toHaveLength(1);
    const ticked = structuredClone(memory.slots.get(1)!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(memory.slots.get(1)).toEqual(ticked);
    expect(screen.getByLabelText("確定した政策の内容")).toHaveTextContent(
      "状態：実施中",
    );
  });

  it("gives manual-mode recovery guidance when the automatic calculator is unavailable", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "first-playable-48", 1, "casual");
    let now = 0;
    vi.useFakeTimers();
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => now} />);
    });
    await autoMode();
    await click("自動進行を始める");
    vi.mocked(OfflineMonthClient.prototype.calculate).mockRejectedValueOnce(
      new Error(
        "自動進行の計算機能を利用できません。手動モードで続けることができます。",
      ),
    );
    now += 300_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "手動モードで続けることができます",
    );
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
    expect(memory.slots.get(1)?.runState).toBe("paused");
  });

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
    await click("国家ビュー");
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

  it("records a backward clock while viewing the game and clears its notice when time reaches the anchor", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "first-playable-48", 1, "casual");
    let now = 1_000_000;
    vi.useFakeTimers();
    await act(async () => {
      render(<App repository={memory.repository} nowMs={() => now} />);
    });
    await autoMode();
    await click("自動進行を始める");
    const running = structuredClone(memory.slots.get(1)!);
    const anchor = running.clock.lastProcessedWallClockMs!;

    now = anchor - 60_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(memory.slots.get(1)?.clock.warning).toBe("CLOCK_MOVED_BACKWARD");
    expect(memory.slots.get(1)?.clock.lastProcessedWallClockMs).toBe(anchor);
    expect(screen.getByText("時刻の調整待ち")).toBeVisible();
    expect(screen.getByText(/端末の時刻が保存時より前/)).toBeVisible();
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
    expect(memory.slots.get(1)?.economy).toEqual(running.economy);
    expect(memory.slots.get(1)?.rng).toEqual(running.rng);

    const warningWrites = memory.attempts;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(memory.attempts).toBe(warningWrites);
    await click("国家ビュー");
    expect(screen.getByText("時刻の調整待ち")).toBeVisible();
    now = anchor;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(memory.slots.get(1)?.clock.warning).toBeUndefined();
    expect(memory.slots.get(1)?.clock.lastProcessedWallClockMs).toBe(anchor);
    expect(memory.slots.get(1)?.clock.remainderMs).toBe(
      running.clock.remainderMs,
    );
    expect(screen.getByText("進行中")).toBeVisible();
    expect(
      screen.queryByText(/端末の時刻が保存時より前/),
    ).not.toBeInTheDocument();
    expect(memory.slots.get(1)?.monthIndex).toBe(0);
    expect(memory.slots.get(1)?.economy).toEqual(running.economy);
    expect(memory.slots.get(1)?.rng).toEqual(running.rng);
    expect(memory.attempts).toBe(warningWrites + 1);
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
    await click("政策会議");
    expect(
      screen.getByRole("heading", { name: "国家ホーム" }),
    ).toBeInTheDocument();
    expect(memory.slots.get(1)?.runState).toBe("running");
    await act(async () => {
      release();
    });
    expect(window.location.pathname).toBe("/game/1/policies");
    expect(screen.getByRole("button", { name: "見通しを確認" })).toBeEnabled();
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
    await click("詳細を閉じる");
    expect(screen.getByRole("button", { name: "帰還報告" })).toHaveFocus();
    await click("レポート");
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
      await click("詳細を閉じる");
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
      screen.queryByRole("button", { name: "見通しを確認" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("保存");
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
    expect(screen.getByRole("alert")).toHaveTextContent("保存");
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
