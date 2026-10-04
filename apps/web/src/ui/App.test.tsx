import { webcrypto } from "node:crypto";
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { policyStateHash } from "../application/policy-view";
import { createGame, type GameRepository } from "../application/game-service";
import { PreviewClient } from "../infrastructure/preview-client";
import { App } from "./App";

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  // jsdom has no layout. Give the real PageDeck enough space for two items
  // so the journey exercises its paging rather than exposing hidden content.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("page-content") ? 240 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
  const originalBounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (!this.hasAttribute("data-page-item"))
        return originalBounds.call(this);
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 320,
        bottom: 100,
        width: 320,
        height: 100,
        toJSON: () => ({}),
      };
    },
  );
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  document.documentElement.style.removeProperty("font-size");
});

function onPage(label: string, find: () => HTMLElement | undefined) {
  const deck = [
    ...document.querySelectorAll<HTMLElement>("[data-page-deck]"),
  ].find((element) => element.getAttribute("aria-label") === label);
  if (!deck) throw new Error(`PageDeck not found: ${label}`);
  const previous = within(deck).getByRole("button", {
    name: `${label}の前のページ`,
  }) as HTMLButtonElement;
  while (!previous.disabled) fireEvent.click(previous);
  const next = within(deck).getByRole("button", {
    name: `${label}の次のページ`,
  }) as HTMLButtonElement;
  for (let page = 0; page < 300; page += 1) {
    const found = find();
    if (found && !found.closest("[hidden]")) return found;
    if (next.disabled) break;
    fireEvent.click(next);
  }
  throw new Error(`Accessible content not found on pages: ${label}`);
}

function roleOnPage(
  label: string,
  role: Parameters<typeof screen.queryAllByRole>[0],
  name: string | RegExp,
) {
  return onPage(label, () => screen.queryAllByRole(role, { name })[0]);
}

function textOnPage(label: string, text: string | RegExp) {
  return onPage(label, () =>
    screen.queryAllByText(text).find((element) => !element.closest("[hidden]")),
  );
}

function memoryRepository() {
  let saved: GameState | null = null;
  let saveFailure: Error | null = null;
  const repository: GameRepository = {
    async load() {
      return saved ? structuredClone(saved) : null;
    },
    async create(state) {
      if (saved) throw new Error("slot occupied");
      saved = structuredClone(state);
    },
    async save(expected, next) {
      if (saveFailure) throw saveFailure;
      if (!saved || policyStateHash(saved) !== expected)
        throw new Error("stale state");
      saved = structuredClone(next);
    },
  };
  return {
    repository,
    get saved() {
      return saved;
    },
    fail(cause = new Error("storage unavailable")) {
      saveFailure = cause;
    },
  };
}

describe("SCN-01 user journey", () => {
  it("keeps text reflow monitoring when stylesheet fonts change after Strict Mode remount", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const callbacks = new Set<ResizeObserverCallback>();
    class SizeObserver {
      constructor(private callback: ResizeObserverCallback) {
        callbacks.add(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        callbacks.delete(this.callback);
      }
    }
    vi.stubGlobal("ResizeObserver", SizeObserver);
    const stylesheet = document.createElement("style");
    stylesheet.textContent = "html { font-size: 16px; }";
    document.head.append(stylesheet);
    try {
      const memory = memoryRepository();
      render(
        <StrictMode>
          <App repository={memory.repository} />
        </StrictMode>,
      );
      await screen.findByRole("heading", { name: "はじめる・続きから" });
      const shell = document.querySelector(".app-shell");
      const rootStyle = document.documentElement.getAttribute("style");
      expect(shell).not.toHaveClass("enlarged-text");

      // A stylesheet/user font setting changes rem sizes without mutating
      // html attributes. Deliver the native resize notifications jsdom lacks.
      stylesheet.textContent = "html { font-size: 32px; }";
      expect(getComputedStyle(document.documentElement).fontSize).toBe("32px");
      act(() => {
        for (const callback of [...callbacks])
          callback([], {} as ResizeObserver);
      });
      await waitFor(() => expect(shell).toHaveClass("enlarged-text"));
      expect(document.documentElement.getAttribute("style")).toBe(rootStyle);

      stylesheet.textContent = "html { font-size: 16px; }";
      act(() => {
        for (const callback of [...callbacks])
          callback([], {} as ResizeObserver);
      });
      await waitFor(() => expect(shell).not.toHaveClass("enlarged-text"));
    } finally {
      cleanup();
      stylesheet.remove();
      vi.stubGlobal("ResizeObserver", originalResizeObserver);
      expect(callbacks.size).toBe(0);
    }
  });

  it("reflows the shell when root text size changes without a resize", async () => {
    const memory = memoryRepository();
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "はじめる・続きから" });
    const shell = document.querySelector(".app-shell");
    expect(shell).not.toHaveClass("enlarged-text");

    document.documentElement.style.fontSize = "200%";
    await waitFor(() => expect(shell).toHaveClass("enlarged-text"));

    document.documentElement.style.fontSize = "16px";
    await waitFor(() => expect(shell).not.toHaveClass("enlarged-text"));
  });

  it("shows empty launch history and offline usage guidance", async () => {
    const memory = memoryRepository();
    render(<App repository={memory.repository} />);

    await screen.findByRole("heading", { name: "はじめる・続きから" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "はじめる",
        }),
      ).toBeEnabled(),
    );
    fireEvent.click(roleOnPage("開始設定", "button", "保存したゲーム"));
    expect(
      textOnPage("開始設定", "保存したゲームはまだありません。"),
    ).toBeInTheDocument();
    fireEvent.click(roleOnPage("開始設定", "button", "遊び方・設定"));
    expect(
      textOnPage("開始設定", /ログインや通信を必要としません/),
    ).toBeInTheDocument();
  });

  it("explains reproduction conditions and preserves the chosen start settings", async () => {
    const memory = memoryRepository();
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "はじめる・続きから" });
    const code = roleOnPage("開始設定", "textbox", "再現用コード（任意）");
    expect(code).toHaveAccessibleDescription(
      "空欄なら自動で作ります。同じコードと開始設定を使い、ゲームの版・設定データ・選ぶ政策・進め方も同じにすると、結果を再現できます。",
    );
    fireEvent.change(code, { target: { value: "reproduce-ui-v1" } });
    fireEvent.change(roleOnPage("開始設定", "combobox", "難易度"), {
      target: { value: "expert" },
    });
    fireEvent.click(roleOnPage("開始設定", "radio", /8年（96か月）/));
    fireEvent.change(roleOnPage("開始設定", "combobox", "説明モード"), {
      target: { value: "casual" },
    });
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    await screen.findByRole("heading", { name: "国家ホーム" });
    expect(memory.saved).toMatchObject({
      difficulty: "expert",
      durationMode: "standard",
      learningMode: "casual",
      rng: { rootSeed: "reproduce-ui-v1" },
      clock: { endMonth: 96 },
    });

    fireEvent.click(screen.getByRole("button", { name: "メニュー" }));
    fireEvent.click(roleOnPage("画面メニュー", "button", "はじめる・続きから"));
    expect(
      textOnPage("開始設定", /0か月目・8年・96か月・専門・カジュアル/),
    ).toBeInTheDocument();
    expect(document.querySelector(".welcome")).not.toHaveTextContent(
      /SCN-01|expert|casual/,
    );
    expect(memory.saved?.rng.rootSeed).toBe("reproduce-ui-v1");
  });

  it("replaces an internal load error with Japanese recovery guidance", async () => {
    const memory = memoryRepository();
    vi.spyOn(memory.repository, "load").mockRejectedValue(
      new Error("Could not open save database macro-nation-games"),
    );
    render(<App repository={memory.repository} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("保存したゲームを読み込めませんでした。");
    expect(alert).toHaveTextContent(
      "ブラウザーの保存設定を確認し、画面を再読み込みしてください。",
    );
    expect(alert).not.toHaveTextContent(/Could not|macro-nation-games/);
  });

  it("identifies which save location used its previous generation", async () => {
    const memory = memoryRepository();
    const initial = await createGame(memory.repository, "ui-slot-recovery");
    const repository: GameRepository = {
      ...memory.repository,
      async loadSlot(id) {
        return id === 1
          ? { state: initial, recovered: false }
          : id === 2
            ? {
                state: { ...initial, slotId: 2 },
                recovered: true,
                reason: "Recovered internal-generation-id from previous",
              }
            : { state: null, recovered: false };
      },
    };
    render(<App repository={repository} />);
    await screen.findByRole("heading", { name: "国家ホーム" });
    expect(
      screen.getByText(
        "保存先2は直前の保存から読み込みました。進み具合を確認してから続けてください。",
      ),
    ).toBeInTheDocument();
    expect(document.querySelector(".app-shell")).not.toHaveTextContent(
      "internal-generation-id",
    );
    expect(memory.saved?.slotId).toBe(1);
  });

  it("explains how to refresh after a concurrent save without displaying the internal error", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "ui-stale-save");
    render(<App repository={memory.repository} />);
    memory.fail(new Error("Saved game changed before policy confirmation"));
    fireEvent.click(await screen.findByRole("button", { name: "1か月進める" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "保存したゲームの状態が変わりました。画面を再読み込みし、最後に保存された状態を確認してください。",
    );
    expect(alert).not.toHaveTextContent("Saved game changed");
    expect(memory.saved?.monthIndex).toBe(0);
  });

  it("shows the save location step when the durable game is no longer available", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "ui-missing-save");
    render(<App repository={memory.repository} />);
    const advance = await screen.findByRole("button", { name: "1か月進める" });
    vi.spyOn(memory.repository, "load").mockResolvedValue(null);
    fireEvent.click(advance);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存したゲームが見つかりませんでした。「はじめる・続きから」で保存先を確認してください。",
    );
    expect(memory.saved?.monthIndex).toBe(0);
  });

  it("does not describe a failed simulation tick as a browser storage problem", async () => {
    const memory = memoryRepository();
    const initial = await createGame(memory.repository, "ui-tick-failure");
    render(<App repository={memory.repository} />);
    const advance = await screen.findByRole("button", { name: "1か月進める" });
    vi.spyOn(memory.repository, "load").mockResolvedValue({
      ...initial,
      economy: {
        ...initial.economy,
        indices: {
          ...initial.economy.indices,
          realGdp: Number.NaN as typeof initial.economy.indices.realGdp,
        },
      },
    });
    const save = vi.spyOn(memory.repository, "save");
    fireEvent.click(advance);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "操作を完了できませんでした。画面を再読み込みし、最後に保存された状態を確認してください。",
    );
    expect(alert).not.toHaveTextContent(/保存設定|空き容量|realGdp|NaN/);
    expect(save).not.toHaveBeenCalled();
    expect(memory.saved?.monthIndex).toBe(0);
    expect(memory.saved?.economy.indices.realGdp).toBe(
      initial.economy.indices.realGdp,
    );
  });

  it("gives the next step when a policy outlook fails without displaying internal details", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "ui-preview-error");
    const request = vi
      .spyOn(PreviewClient.prototype, "request")
      .mockRejectedValueOnce(
        new Error("Policy preview worker failed: ui05:internal-state-hash"),
      );
    try {
      render(<App repository={memory.repository} />);
      fireEvent.click(await screen.findByRole("button", { name: "政策会議" }));
      fireEvent.click(screen.getByRole("button", { name: "見通しを確認" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "政策の見通しを確認できませんでした。政策会議に戻り、設定を確認してもう一度お試しください。",
      );
      expect(alert).not.toHaveTextContent(/worker|ui05|internal-state-hash/);
      expect(memory.saved?.policies.reserved).toHaveLength(0);
    } finally {
      request.mockRestore();
    }
  });

  it("opens the nation view from home and reaches the same region from its DOM list", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "nation-view-accessibility");
    render(<App repository={memory.repository} />);
    fireEvent.click(await screen.findByRole("button", { name: "国家ビュー" }));
    expect(screen.getByRole("heading", { name: "国家ビュー" })).toHaveFocus();
    expect(window.location.pathname).toBe("/game/1/nation");
    fireEvent.click(screen.getByRole("button", { name: "地域一覧" }));
    fireEvent.click(roleOnPage("地域一覧", "button", /港湾 安定/));
    expect(textOnPage("地域の様子", /輸出（月間）/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "経済レポートで理由を見る" }),
    );
    expect(screen.getByRole("heading", { name: "経済レポート" })).toHaveFocus();
    expect(memory.saved?.runState).toBe("paused");
  });

  // This journey runs the real 12- and 60-month Engine previews. Hosted CI
  // shares CPU with the other suites and can take over 20 seconds.
  it("starts, previews, saves once, advances, and explains the result after browser back", async () => {
    const memory = memoryRepository();
    render(
      <App repository={memory.repository} seedFactory={() => "ui-flow-v1"} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "はじめる" }));
    expect(
      await screen.findByRole("heading", { name: "国家ホーム" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ゲームを開始し、端末に保存しました。"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "国家ホーム" })).toHaveFocus(),
    );
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(
      screen.getAllByRole("heading", { name: "いちばん大きく影響したこと" })[0],
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "ホームの詳細" }), {
      target: { value: "recommendations" },
    });
    expect(
      roleOnPage("首席補佐官の提案", "heading", "首席補佐官の提案"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "ホームの詳細" }), {
      target: { value: "milestones" },
    });
    expect(
      textOnPage("次の節目", "48月目：予定の運営期間が終わります"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "政策会議" }));
    expect(screen.getByText(/残り 3 \/ 3枠/)).toBeInTheDocument();
    fireEvent.change(roleOnPage("政策会議", "spinbutton", "政策金利の設定値"), {
      target: { value: "0.05" },
    });
    fireEvent.click(roleOnPage("政策会議", "checkbox", /中央銀行/));
    fireEvent.click(screen.getByRole("button", { name: "見通しを確認" }));
    expect(
      await screen.findByRole("heading", { name: "政策の見通し" }),
    ).toHaveFocus();
    expect(
      textOnPage(
        "政策の見通し",
        /この範囲に収まる確率を示すものではありません/,
      ),
    ).toBeInTheDocument();
    expect(
      roleOnPage("政策の見通し", "heading", "別の政策を選んだら"),
    ).toBeInTheDocument();
    expect(
      roleOnPage("政策の見通し", "heading", "今の政策を続ける"),
    ).toBeInTheDocument();
    expect(
      roleOnPage("政策の見通し", "heading", "1年・5年の見通し"),
    ).toBeInTheDocument();
    expect(
      roleOnPage("政策の見通し", "heading", "マクロ経済"),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "政策を確定する" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(memory.saved?.policies.reserved).toHaveLength(0);
    fireEvent.click(
      roleOnPage(
        "政策の見通し",
        "checkbox",
        "費用・副作用・警告を確認しました",
      ),
    );
    roleOnPage("政策の見通し", "heading", "1年・5年の見通し");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(
      await screen.findByText("政策を確定し、端末に保存しました。"),
    ).toBeInTheDocument();
    expect(memory.saved?.policies.reserved).toHaveLength(1);
    expect(memory.saved?.policies.reserved[0]?.selectedExpertIds).toEqual([
      "macro",
      "centralBank",
    ]);
    expect(memory.saved?.policyAdministration?.receipts).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "政策会議" }));
    expect(
      textOnPage("政策会議", "政策金利：予約中、1月目に開始"),
    ).toBeInTheDocument();
    expect(document.querySelector(".game-view")).not.toHaveTextContent(
      memory.saved!.policies.reserved[0]!.policyId,
    );
    window.history.back();
    fireEvent.popState(window);
    expect(memory.saved?.policyAdministration?.receipts).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "ホーム" }));
    fireEvent.click(screen.getByRole("button", { name: "1か月進める" }));
    await waitFor(() => expect(memory.saved?.monthIndex).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "レポート" }));
    expect(screen.getByRole("heading", { name: "経済レポート" })).toHaveFocus();
    expect(
      roleOnPage("経済レポート", "heading", "変化の理由"),
    ).toBeInTheDocument();
    expect(
      roleOnPage("経済レポート", "heading", "経済学ノート"),
    ).toBeInTheDocument();
    expect(
      memory.saved?.history.learningEntries?.map((item) => item.kind),
    ).toEqual(["term", "theory", "decision", "verification"]);
    expect(
      roleOnPage("経済レポート", "heading", "経済ニュース"),
    ).toBeInTheDocument();
  }, 60_000);

  it("keeps policy inputs and experts while paging and switching screens", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "ui-draft-pages");
    render(<App repository={memory.repository} />);
    fireEvent.click(await screen.findByRole("button", { name: "政策会議" }));
    fireEvent.change(roleOnPage("政策会議", "spinbutton", "政策金利の設定値"), {
      target: { value: "0.05" },
    });
    fireEvent.change(roleOnPage("政策会議", "combobox", "政策を始める時期"), {
      target: { value: "2" },
    });
    fireEvent.click(roleOnPage("政策会議", "checkbox", /中央銀行/));

    expect(
      roleOnPage("政策会議", "spinbutton", "政策金利の設定値"),
    ).toHaveValue(0.05);
    fireEvent.click(screen.getByRole("button", { name: "レポート" }));
    fireEvent.click(screen.getByRole("button", { name: "政策会議" }));
    expect(
      roleOnPage("政策会議", "spinbutton", "政策金利の設定値"),
    ).toHaveValue(0.05);
    expect(roleOnPage("政策会議", "combobox", "政策を始める時期")).toHaveValue(
      "2",
    );
    expect(roleOnPage("政策会議", "checkbox", /中央銀行/)).toBeChecked();
    expect(memory.saved?.policies.reserved).toHaveLength(0);
    expect(memory.saved?.policyAdministration?.receipts ?? []).toHaveLength(0);
  });

  it("blocks month progression until an event response is explicitly saved", async () => {
    const memory = memoryRepository();
    const initial = await createGame(memory.repository, "ui-event-pages");
    await memory.repository.save(policyStateHash(initial), {
      ...initial,
      runState: "awaitingEvent",
      events: {
        ...initial.events,
        activeEventIds: ["evt-demand-slump"],
        pendingChoiceEventId: "evt-demand-slump",
        occurrences: [
          {
            eventId: "evt-demand-slump",
            occurredMonth: 0,
            preparedness: 0.5,
            baselineDamage: -2,
            preparednessMitigation: 0.5,
            choiceMitigation: 0,
            targetPath: "economy.indices.realGdp",
          },
        ],
      },
    });
    render(<App repository={memory.repository} />);
    const advance = await screen.findByRole("button", { name: "1か月進める" });
    expect(advance).toBeDisabled();
    fireEvent.click(advance);
    expect(memory.saved?.monthIndex).toBe(0);
    expect(memory.saved?.events.occurrences?.[0]?.choiceId).toBeUndefined();
    expect(
      roleOnPage(
        "危機や出来事への対応",
        "heading",
        "突発イベント：対応を選んでください",
      ),
    ).toBeInTheDocument();
    expect(
      textOnPage("危機や出来事への対応", /出来事の内容：.*需要/),
    ).toBeInTheDocument();
    expect(document.querySelector(".game-view")).not.toHaveTextContent(
      "evt-demand-slump",
    );
    expect(advance).toBeDisabled();
    fireEvent.click(
      roleOnPage("危機や出来事への対応", "button", "バランスを取る"),
    );
    await waitFor(() => expect(memory.saved?.runState).toBe("paused"));
    expect(memory.saved?.monthIndex).toBe(0);
    expect(memory.saved?.events.pendingChoiceEventId).toBeUndefined();
    expect(memory.saved?.events.occurrences?.[0]).toMatchObject({
      choiceId: "balanced",
      choiceMitigation: 0.3,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "1か月進める",
        }),
      ).toBeEnabled(),
    );
  });

  it("keeps a draft pending when durable save fails", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "ui-save-failure");
    render(<App repository={memory.repository} />);
    fireEvent.click(await screen.findByRole("button", { name: "政策会議" }));
    fireEvent.click(screen.getByRole("button", { name: "見通しを確認" }));
    await screen.findByRole("heading", { name: "政策の見通し" });
    fireEvent.click(
      roleOnPage(
        "政策の見通し",
        "checkbox",
        "費用・副作用・警告を確認しました",
      ),
    );
    memory.fail();
    fireEvent.click(screen.getByRole("button", { name: "政策を確定する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存を確認できませんでした。",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "最後に保存された状態を確認してください。",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "storage unavailable",
    );
    expect(memory.saved?.policies.reserved).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "政策を確定する" }),
    ).toBeEnabled();
  });

  it.each([
    ["completed", "予定期間を終えました", "予定期間を終了"],
    ["failed", "危機で運営が終了しました", "危機で終了"],
  ] as const)(
    "distinguishes a %s ending on the home screen",
    async (runState, heading, status) => {
      const memory = memoryRepository();
      const initial = await createGame(
        memory.repository,
        `ui-ending-${runState}`,
      );
      await memory.repository.save(policyStateHash(initial), {
        ...initial,
        runState,
      });
      render(<App repository={memory.repository} />);
      await screen.findByRole("heading", { name: "国家ホーム" });
      expect(
        roleOnPage("危機や出来事への対応", "heading", heading),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "時間の進行" }),
      ).toHaveTextContent(status);
      expect(
        screen.getByRole("button", { name: "1か月進める" }),
      ).toBeDisabled();
      expect(memory.saved?.runState).toBe(runState);
    },
  );
});
