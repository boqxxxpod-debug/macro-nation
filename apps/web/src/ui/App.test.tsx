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
  // PageDeck keeps each item mounted and changes hidden between pages.
  // Resolve candidates once rather than recalculating visibility for the
  // entire document after every page turn.
  const candidates = screen.queryAllByRole(role, { name, hidden: true });
  return onPage(label, () =>
    candidates.find(
      (element) => element.isConnected && !element.closest("[hidden]"),
    ),
  );
}

function textOnPage(label: string, text: string | RegExp) {
  return onPage(label, () =>
    screen.queryAllByText(text).find((element) => !element.closest("[hidden]")),
  );
}

function textAcrossPages(label: string) {
  const deck = [
    ...document.querySelectorAll<HTMLElement>("[data-page-deck]"),
  ].find((element) => element.getAttribute("aria-label") === label)!;
  const previous = within(deck).getByRole("button", {
    name: `${label}の前のページ`,
  }) as HTMLButtonElement;
  while (!previous.disabled) fireEvent.click(previous);
  const next = within(deck).getByRole("button", {
    name: `${label}の次のページ`,
  }) as HTMLButtonElement;
  const text: string[] = [];
  for (let page = 0; page < 300; page += 1) {
    text.push(
      [...deck.querySelectorAll<HTMLElement>("[data-page-item]:not([hidden])")]
        .map((item) => item.textContent)
        .join(" "),
    );
    if (next.disabled) return text.join(" ");
    fireEvent.click(next);
  }
  throw new Error(`PageDeck exceeded the expected page count: ${label}`);
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
    replace(state: GameState) {
      saved = structuredClone(state);
    },
    fail(cause = new Error("storage unavailable")) {
      saveFailure = cause;
    },
  };
}

function scenarioRepository(completedScenarioIds?: readonly string[]) {
  const saved = new Map<number, GameState>();
  const startCommands = new Map<number, string>();
  const repository: GameRepository = {
    async load(id) {
      return saved.has(id) ? structuredClone(saved.get(id)!) : null;
    },
    async create(state, commandId) {
      if (saved.has(state.slotId)) {
        if (commandId && startCommands.get(state.slotId) === commandId) return;
        throw new Error("slot occupied");
      }
      saved.set(state.slotId, structuredClone(state));
      if (commandId) startCommands.set(state.slotId, commandId);
    },
    async save(expected, next) {
      const before = saved.get(next.slotId);
      if (!before || policyStateHash(before) !== expected)
        throw new Error("stale state");
      saved.set(next.slotId, structuredClone(next));
    },
    ...(completedScenarioIds
      ? {
          async loadProgression() {
            return { completedScenarioIds };
          },
        }
      : {}),
  };
  return { repository, saved };
}

describe("scenario selection", () => {
  it("shows all three challenges and keeps advanced scenarios locked before completion", async () => {
    const memory = scenarioRepository();
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "はじめる・続きから" });
    const select = roleOnPage("開始設定", "combobox", "シナリオ");
    expect(within(select).getAllByRole("option")).toHaveLength(3);
    expect(
      within(select).getByRole("option", { name: "小さな開放経済" }),
    ).toBeEnabled();
    for (const title of ["通貨安と輸入インフレ", "関税応酬と供給制約"])
      expect(
        within(select).getByRole("option", { name: new RegExp(title) }),
      ).toBeDisabled();
    fireEvent.change(select, { target: { value: "SCN-02" } });
    expect(select).toHaveValue("SCN-01");
    expect(screen.getByLabelText("選択中の開始設定")).toHaveTextContent(
      "シナリオ：小さな開放経済",
    );
    const catalog = textAcrossPages("開始設定");
    for (const description of [
      /穏やかな物価高と成長鈍化に向き合う/,
      /通貨安によって輸入品の価格が上がっている/,
      /金利と為替介入だけでは解けない/,
      /相手国との関係が悪化し、物価高と成長停滞/,
      /国内産業の保護と、輸入品を使う産業や家計の費用/,
      /解放条件：小さな開放経済を予定期間の最後まで完了/,
    ])
      expect(catalog).toMatch(description);
    expect(memory.saved.size).toBe(0);
  }, 15_000);

  it("unlocks from a committed introduction completion and starts the chosen advanced scenario", async () => {
    const memory = scenarioRepository();
    const introduction = await createGame(
      memory.repository,
      "completed-introduction",
    );
    await memory.repository.save(policyStateHash(introduction), {
      ...introduction,
      runState: "completed",
      monthIndex: introduction.clock.endMonth!,
    });
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "国家ビュー" });
    fireEvent.click(screen.getByRole("button", { name: "保存スロット" }));
    const select = roleOnPage("開始設定", "combobox", "シナリオ");
    for (const title of ["通貨安と輸入インフレ", "関税応酬と供給制約"])
      expect(within(select).getByRole("option", { name: title })).toBeEnabled();
    fireEvent.change(select, { target: { value: "SCN-02" } });
    expect(screen.getByLabelText("選択中の開始設定")).toHaveTextContent(
      "シナリオ：通貨安と輸入インフレ・難易度：入門・期間：8年",
    );
    fireEvent.click(roleOnPage("開始設定", "radio", /30年（360か月）/));
    fireEvent.change(roleOnPage("開始設定", "combobox", "シナリオ"), {
      target: { value: "SCN-03" },
    });
    expect(screen.getByLabelText("選択中の開始設定")).toHaveTextContent(
      "期間：8年",
    );
    fireEvent.click(roleOnPage("開始設定", "radio", /4年（48か月）/));
    fireEvent.click(roleOnPage("開始設定", "button", "保存先2ではじめる"));
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    await screen.findByRole("heading", { name: "国家ビュー" });
    expect(memory.saved.get(2)).toMatchObject({
      scenarioId: "SCN-03",
      durationMode: "short",
      clock: { endMonth: 48 },
    });
    expect(document.querySelector(".shell-scenario")).toHaveTextContent(
      "関税応酬と供給制約",
    );
    fireEvent.click(screen.getByRole("button", { name: "地域一覧" }));
    fireEvent.change(screen.getByRole("combobox", { name: "見たい内容" }), {
      target: { value: "guidance" },
    });
    expect(textOnPage("運営の案内", "為替指数：108.0")).toBeVisible();
    expect(textOnPage("運営の案内", "外貨準備：6.0か月分")).toBeVisible();
    expect(textOnPage("運営の案内", "相手国関係：40.0")).toBeVisible();
    expect(textOnPage("運営の案内", "政府債務のGDP比：95.0%")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "詳細を閉じる" }));
    fireEvent.click(screen.getByRole("button", { name: "保存スロット" }));
    expect(
      textOnPage("開始設定", /関税応酬と供給制約・0か月目/),
    ).toBeInTheDocument();
    fireEvent.click(roleOnPage("開始設定", "button", "保存先2の続きから"));
    await screen.findByRole("heading", { name: "国家ビュー" });
    expect(document.querySelector(".shell-scenario")).toHaveTextContent(
      "関税応酬と供給制約",
    );
  }, 15_000);

  it("keeps advanced scenarios locked after a failed introduction", async () => {
    const memory = scenarioRepository();
    const introduction = await createGame(
      memory.repository,
      "failed-introduction",
    );
    await memory.repository.save(policyStateHash(introduction), {
      ...introduction,
      runState: "failed",
    });
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "国家ビュー" });
    fireEvent.click(screen.getByRole("button", { name: "保存スロット" }));
    const select = roleOnPage("開始設定", "combobox", "シナリオ");
    expect(
      within(select).getByRole("option", { name: /通貨安と輸入インフレ/ }),
    ).toBeDisabled();
    expect(
      within(select).getByRole("option", { name: /関税応酬と供給制約/ }),
    ).toBeDisabled();
  });

  it("uses persisted completion without requiring an introduction save and preserves the selected scenario on a start retry", async () => {
    const memory = scenarioRepository(["SCN-01"]);
    const view = render(
      <App
        repository={memory.repository}
        seedFactory={() => "advanced-retry"}
      />,
    );
    await screen.findByRole("heading", { name: "はじめる・続きから" });
    fireEvent.change(roleOnPage("開始設定", "combobox", "シナリオ"), {
      target: { value: "SCN-02" },
    });
    const create = vi
      .spyOn(memory.repository, "create")
      .mockRejectedValueOnce(new Error("storage unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("選択中の開始設定")).toHaveTextContent(
      "シナリオ：通貨安と輸入インフレ",
    );
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    await screen.findByRole("heading", { name: "国家ビュー" });
    expect(memory.saved.get(1)).toMatchObject({
      scenarioId: "SCN-02",
      durationMode: "standard",
      rng: { rootSeed: "advanced-retry" },
      clock: { endMonth: 96 },
    });
    expect(create.mock.calls[0]?.[0].scenarioId).toBe("SCN-02");
    expect(create.mock.calls[1]?.[0].scenarioId).toBe("SCN-02");
    expect(create.mock.calls[1]?.[1]).toBe(create.mock.calls[0]?.[1]);
    view.unmount();
    memory.saved.clear();
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "はじめる・続きから" });
    const select = roleOnPage("開始設定", "combobox", "シナリオ");
    expect(
      within(select).getByRole("option", { name: "通貨安と輸入インフレ" }),
    ).toBeEnabled();
    expect(
      within(select).getByRole("option", { name: "関税応酬と供給制約" }),
    ).toBeEnabled();
  });

  it("rejects a different selected scenario after an acknowledged creation could not be read", async () => {
    const memory = scenarioRepository(["SCN-01"]);
    render(
      <App
        repository={memory.repository}
        seedFactory={() => "committed-start-retry"}
      />,
    );
    await screen.findByRole("heading", { name: "はじめる・続きから" });
    fireEvent.change(roleOnPage("開始設定", "combobox", "シナリオ"), {
      target: { value: "SCN-02" },
    });
    vi.spyOn(memory.repository, "load").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    await screen.findByRole("alert");
    expect(memory.saved.get(1)?.scenarioId).toBe("SCN-02");
    fireEvent.change(roleOnPage("開始設定", "combobox", "シナリオ"), {
      target: { value: "SCN-03" },
    });
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "はじめる" })).toBeEnabled(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "この保存先にはゲームがあります",
    );
    expect(
      screen.getByRole("heading", { name: "はじめる・続きから" }),
    ).toBeVisible();
    expect(memory.saved.get(1)?.scenarioId).toBe("SCN-02");
    fireEvent.change(roleOnPage("開始設定", "combobox", "シナリオ"), {
      target: { value: "SCN-02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    await screen.findByRole("heading", { name: "国家ビュー" });
    expect(document.querySelector(".shell-scenario")).toHaveTextContent(
      "通貨安と輸入インフレ",
    );
  });

  it("retains an automatically generated seed when retrying an acknowledged start", async () => {
    const memory = scenarioRepository(["SCN-01"]);
    const seedFactory = vi
      .fn()
      .mockReturnValueOnce("original-automatic-seed")
      .mockReturnValue("different-rerolled-seed");
    render(<App repository={memory.repository} seedFactory={seedFactory} />);
    await screen.findByRole("heading", { name: "はじめる・続きから" });
    fireEvent.change(roleOnPage("開始設定", "combobox", "シナリオ"), {
      target: { value: "SCN-02" },
    });
    vi.spyOn(memory.repository, "load").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    await screen.findByRole("alert");
    expect(memory.saved.get(1)?.rng.rootSeed).toBe("original-automatic-seed");
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    await screen.findByRole("heading", { name: "国家ビュー" });
    expect(seedFactory).toHaveBeenCalledTimes(1);
    expect(memory.saved.get(1)?.rng.rootSeed).toBe("original-automatic-seed");
    expect(document.querySelector(".shell-scenario")).toHaveTextContent(
      "通貨安と輸入インフレ",
    );
  });
});

describe("SCN-01 user journey", () => {
  it("keeps the objective, play loop, and selected settings beside the start action", async () => {
    const memory = memoryRepository();
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "はじめる・続きから" });

    const objective = screen.getByText(
      "暮らし・成長・安定・持続性・信頼のバランスを考え、国を育てましょう。",
    );
    const loop = screen.getByText(
      "政策を比べる → 月を進める → 結果と理由を見る",
    );
    expect(objective).toBeVisible();
    expect(loop).toBeVisible();
    expect(objective.closest(".page-content")).toBeNull();
    expect(loop.closest(".page-content")).toBeNull();
    expect(screen.getByText(/架空国家を運営するゲームです/)).toBeVisible();
    expect(
      textOnPage(
        "開始設定",
        /終了時は「暮らし」「成長」「安定」「持続性」「信頼」/,
      ),
    ).toBeInTheDocument();
    expect(
      textOnPage("開始設定", /政策や専門家の視点を比べながら/),
    ).toBeInTheDocument();

    const summary = screen.getByLabelText("選択中の開始設定");
    expect(summary).toBeVisible();
    expect(summary).toHaveTextContent(
      "難易度：入門・期間：4年・学習モード：学習・保存先：1・再現用コード：自動",
    );
    expect(summary.closest(".page-actions")).toContainElement(
      screen.getByRole("button", { name: "はじめる" }),
    );

    fireEvent.change(roleOnPage("開始設定", "combobox", "難易度"), {
      target: { value: "expert" },
    });
    fireEvent.click(roleOnPage("開始設定", "radio", /8年（96か月）/));
    fireEvent.change(roleOnPage("開始設定", "combobox", "説明モード"), {
      target: { value: "casual" },
    });
    fireEvent.click(roleOnPage("開始設定", "button", "保存先2ではじめる"));
    fireEvent.change(
      roleOnPage("開始設定", "textbox", "再現用コード（任意）"),
      {
        target: { value: "chosen-start-seed" },
      },
    );
    expect(summary).toBeVisible();
    expect(summary).toHaveTextContent(
      "難易度：専門・期間：8年・学習モード：カジュアル・保存先：2・再現用コード：入力あり",
    );
    expect(memory.saved).toBeNull();
  });

  it("offers the full play guide before starting and through the game menu without changing the game", async () => {
    const memory = memoryRepository();
    const view = render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "はじめる・続きから" });
    fireEvent.click(roleOnPage("開始設定", "button", "遊び方・設定"));
    for (const step of [
      "1. 政策を比べる",
      "2. 月を進める",
      "3. 結果と理由を見る",
    ])
      expect(roleOnPage("開始設定", "heading", step)).toBeInTheDocument();
    expect(
      textOnPage(
        "開始設定",
        /開始後にシナリオ、難易度、期間、再現用コードは変更できません/,
      ),
    ).toBeInTheDocument();
    view.unmount();

    await createGame(memory.repository, "guide-read-only");
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "国家ビュー" });
    const before = structuredClone(memory.saved);
    const save = vi.spyOn(memory.repository, "save");
    const location = window.location.pathname;
    fireEvent.click(screen.getByRole("button", { name: "メニュー" }));
    fireEvent.click(roleOnPage("画面メニュー", "button", "遊び方・設定"));
    for (const step of [
      "1. 政策を比べる",
      "2. 月を進める",
      "3. 結果と理由を見る",
    ])
      expect(roleOnPage("遊び方・設定", "heading", step)).toBeInTheDocument();
    expect(
      textOnPage("遊び方・設定", /ログインや通信を必要としません/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "画面メニューに戻る" }));
    fireEvent.click(roleOnPage("画面メニュー", "button", "遊び方・設定"));
    fireEvent.click(screen.getByRole("button", { name: "遊び方を閉じる" }));
    expect(screen.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "メニュー" })).toHaveFocus(),
    );
    expect(window.location.pathname).toBe(location);
    expect(save).not.toHaveBeenCalled();
    expect(memory.saved).toEqual(before);
  }, 15_000);

  it("opens the development preview separately and returns to its menu entry without changing the game", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "dev-preview-navigation");
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "国家ビュー" });
    const before = structuredClone(memory.saved);
    const save = vi.spyOn(memory.repository, "save");
    const location = window.location.pathname;
    fireEvent.click(screen.getByRole("button", { name: "メニュー" }));
    fireEvent.click(
      roleOnPage("画面メニュー", "button", "開発用AIプレビューを開く"),
    );
    expect(
      screen.queryByRole("region", { name: "画面メニュー" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "開発用AIプレビューのカテゴリ" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "画面メニューに戻る" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "開発用AIプレビューを開く" }),
      ).toHaveFocus(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "開発用AIプレビューを開く" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "メニュー" })).toHaveFocus(),
    );
    expect(screen.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "メニュー" }));
    fireEvent.click(
      roleOnPage("画面メニュー", "button", "開発用AIプレビューを開く"),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "メニュー" })).toHaveFocus(),
    );
    expect(window.location.pathname).toBe(location);
    expect(save).not.toHaveBeenCalled();
    expect(memory.saved).toEqual(before);
  });

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
    await screen.findByRole("heading", { name: "国家ビュー" });
    expect(memory.saved).toMatchObject({
      difficulty: "expert",
      durationMode: "standard",
      learningMode: "casual",
      rng: { rootSeed: "reproduce-ui-v1" },
      clock: { endMonth: 96 },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存スロット" }));
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
    await screen.findByRole("heading", { name: "国家ビュー" });
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
      fireEvent.click(
        await screen.findByRole("button", {
          name: /^(政策会議|政策を考える)$/,
        }),
      );
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

  it("resumes at the nation main screen and reaches the same region from its DOM list", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "nation-view-accessibility");
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "国家ビュー" });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "国家ビュー" })).toHaveFocus(),
    );
    expect(window.location.pathname).toBe("/game/1/nation");
    const savedHash = policyStateHash(memory.saved!);
    fireEvent.click(screen.getByRole("button", { name: "地域一覧" }));
    fireEvent.click(roleOnPage("地域一覧", "button", /港湾 安定/));
    expect(textOnPage("地域の様子", /輸出（月間）/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "経済レポートで理由を見る" }),
    );
    expect(screen.getByRole("heading", { name: "経済レポート" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "国家ビューに戻る" }));
    expect(screen.getByRole("heading", { name: "国家ビュー" })).toHaveFocus();
    expect(policyStateHash(memory.saved!)).toBe(savedHash);
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
      await screen.findByRole("heading", { name: "国家ビュー" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ゲームを開始し、端末に保存しました。"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "国家ビュー" })).toHaveFocus(),
    );
    expect(window.location.pathname).toBe("/game/1/nation");
    fireEvent.click(screen.getByRole("button", { name: "経済指標を見る" }));
    expect(window.location.pathname).toBe("/game/1/indicators");
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
    fireEvent.click(screen.getByRole("button", { name: "国家ビューに戻る" }));
    fireEvent.click(
      screen.getByRole("button", { name: /^(政策会議|政策を考える)$/ }),
    );
    expect(screen.getByText(/残り 3 \/ 3枠/)).toBeInTheDocument();
    fireEvent.change(
      roleOnPage("政策会議", "spinbutton", "政策金利（年率・%）"),
      {
        target: { value: "5" },
      },
    );
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
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "国家ビュー" })).toHaveFocus(),
    );
    expect(window.location.pathname).toBe("/game/1/nation");
    expect(memory.saved?.policies.reserved).toHaveLength(1);
    expect(memory.saved?.policies.reserved[0]?.inputs?.value).toBe(0.05);
    expect(memory.saved?.policies.reserved[0]?.selectedExpertIds).toEqual([
      "macro",
      "centralBank",
    ]);
    expect(memory.saved?.policyAdministration?.receipts).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: /^(政策会議|政策を考える)$/ }),
    );
    expect(
      textOnPage("政策会議", "政策金利：予約中、1月目に開始"),
    ).toBeInTheDocument();
    expect(document.querySelector(".game-view")).not.toHaveTextContent(
      memory.saved!.policies.reserved[0]!.policyId,
    );
    window.history.back();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "国家ビュー" })).toHaveFocus(),
    );
    expect(memory.saved?.policyAdministration?.receipts).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "1か月進める" }));
    await waitFor(() => expect(memory.saved?.monthIndex).toBe(1));
    fireEvent.click(
      screen.getByRole("button", { name: /^(レポート|理由を見る)$/ }),
    );
    expect(screen.getByRole("heading", { name: "経済レポート" })).toHaveFocus();
    expect(
      roleOnPage("経済レポート", "heading", "1月目・実質GDPの変化の理由"),
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
    fireEvent.click(
      await screen.findByRole("button", { name: /^(政策会議|政策を考える)$/ }),
    );
    fireEvent.change(
      roleOnPage("政策会議", "spinbutton", "政策金利（年率・%）"),
      {
        target: { value: "5" },
      },
    );
    fireEvent.change(roleOnPage("政策会議", "combobox", "政策を始める時期"), {
      target: { value: "2" },
    });
    fireEvent.click(roleOnPage("政策会議", "checkbox", /中央銀行/));

    expect(
      roleOnPage("政策会議", "spinbutton", "政策金利（年率・%）"),
    ).toHaveValue(5);
    fireEvent.click(
      screen.getByRole("button", { name: /^(レポート|理由を見る)$/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^(政策会議|政策を考える)$/ }),
    );
    expect(
      roleOnPage("政策会議", "spinbutton", "政策金利（年率・%）"),
    ).toHaveValue(5);
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
    fireEvent.click(
      screen.getByRole("button", { name: "イベントの対応を選ぶ" }),
    );
    expect(window.location.pathname).toBe("/game/1/events");
    expect(
      roleOnPage(
        "イベントへの対応",
        "heading",
        "突発イベント：対応を選んでください",
      ),
    ).toBeInTheDocument();
    expect(
      textOnPage("イベントへの対応", /出来事の内容：.*需要/),
    ).toBeInTheDocument();
    expect(document.querySelector(".game-view")).not.toHaveTextContent(
      "evt-demand-slump",
    );
    expect(advance).toBeDisabled();
    fireEvent.click(roleOnPage("イベントへの対応", "button", "バランスを取る"));
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
    fireEvent.click(
      await screen.findByRole("button", { name: /^(政策会議|政策を考える)$/ }),
    );
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
  }, 15_000);

  it.each([
    ["completed", "予定期間を終えました", "予定期間を終了"],
    ["failed", "危機で運営が終了しました", "危機で終了"],
  ] as const)(
    "distinguishes a %s ending on the nation and indicators screens",
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
      await screen.findByRole("heading", { name: "国家ビュー" });
      expect(
        screen.getByRole("region", { name: "時間の進行" }),
      ).toHaveTextContent(status);
      expect(
        screen.getByRole("button", { name: "1か月進める" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "経済指標を見る" }));
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
  it("preserves a report deep link and returns to the nation main screen", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "nation-report-deep-link");
    window.history.replaceState({}, "", "/game/1/report");
    render(<App repository={memory.repository} />);
    await screen.findByRole("heading", { name: "経済レポート" });
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "経済レポート" }),
      ).toHaveFocus(),
    );
    expect(window.location.pathname).toBe("/game/1/report");
    fireEvent.click(screen.getByRole("button", { name: "国家ビューに戻る" }));
    expect(window.location.pathname).toBe("/game/1/nation");
    expect(memory.saved?.monthIndex).toBe(0);
  });
  it("preserves the requested empty slot when browser history switches games", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "nation-empty-slot-history");
    const repository: GameRepository = {
      ...memory.repository,
      async load(id) {
        return id === 1 ? memory.repository.load(id) : null;
      },
    };
    window.history.replaceState({}, "", "/game/1/nation");
    render(<App repository={repository} />);
    await screen.findByRole("heading", { name: "国家ビュー" });
    window.history.pushState({}, "", "/game/2/nation");
    fireEvent.popState(window);
    expect(
      await screen.findByRole("heading", { name: "はじめる・続きから" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/game/2/nation");
  });

  it("loads the requested slot and keeps its latest progress when reopened", async () => {
    const saved = new Map<number, GameState>();
    const repository: GameRepository = {
      async load(id) {
        return saved.has(id) ? structuredClone(saved.get(id)!) : null;
      },
      async create(state) {
        saved.set(state.slotId, structuredClone(state));
      },
      async save(expected, state) {
        if (policyStateHash(saved.get(state.slotId)!) !== expected)
          throw new Error("stale state");
        saved.set(state.slotId, structuredClone(state));
      },
    };
    await createGame(repository, "nation-slot-one", 1);
    await createGame(repository, "nation-slot-two", 2, "learning", "long");
    window.history.replaceState({}, "", "/game/2");
    const { unmount } = render(<App repository={repository} />);
    await screen.findByRole("heading", { name: "国家ビュー" });
    expect(window.location.pathname).toBe("/game/2/nation");
    expect(screen.getByText("0 / 240か月")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1か月進める" }));
    await screen.findByText(/まで進み、保存しました/);
    expect(saved.get(2)?.monthIndex).toBe(1);
    expect(saved.get(1)?.monthIndex).toBe(0);
    expect(screen.getByText("1 / 240か月")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /保存スロット/ }));
    fireEvent.click(roleOnPage("開始設定", "button", "保存先2の続きから"));
    expect(screen.getByText(/保存先2.*1年目 2月/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /経済指標を見る/ }));
    expect(window.location.pathname).toBe("/game/2/indicators");
    unmount();
    render(<App repository={repository} />);
    await screen.findByRole("heading", { name: "経済指標" });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "経済指標" })).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("button", { name: "国家ビューに戻る" }));
    expect(window.location.pathname).toBe("/game/2/nation");
    expect(screen.getByText(/保存先2.*1年目 2月/)).toBeInTheDocument();
  });

  it.each([
    ["crisisStopped", "緊急会議を開く", "緊急会議", "crisis"],
    ["awaitingEvent", "イベントの対応を選ぶ", "イベント対応", "events"],
  ] as const)(
    "keeps %s stopped and links to its response screen",
    async (status, button, heading, path) => {
      const memory = memoryRepository();
      const initial = await createGame(memory.repository, `nation-${status}`);
      memory.replace({
        ...initial,
        runState: status,
        events:
          status === "awaitingEvent"
            ? {
                ...initial.events,
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
              }
            : initial.events,
      });
      render(<App repository={memory.repository} />);
      await screen.findByRole("heading", { name: "国家ビュー" });
      expect(
        screen.getByRole("button", { name: "1か月進める" }),
      ).toBeDisabled();
      const hash = policyStateHash(memory.saved!);
      fireEvent.click(screen.getByRole("button", { name: button }));
      expect(screen.getByRole("heading", { name: heading })).toHaveFocus();
      expect(window.location.pathname).toBe(`/game/1/${path}`);
      fireEvent.click(screen.getByRole("button", { name: "国家ビューに戻る" }));
      expect(policyStateHash(memory.saved!)).toBe(hash);
      expect(
        screen.getByRole("button", { name: "1か月進める" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: button }));
      fireEvent.click(
        roleOnPage(
          status === "crisisStopped" ? "緊急会議への対応" : "イベントへの対応",
          "button",
          status === "crisisStopped"
            ? "危機対応を確認して再開"
            : "バランスを取る",
        ),
      );
      await screen.findByRole("heading", { name: "国家ビュー" });
      await waitFor(() =>
        expect(
          screen.getByRole("heading", { name: "国家ビュー" }),
        ).toHaveFocus(),
      );
      expect(memory.saved?.runState).toBe("paused");
      expect(memory.saved?.monthIndex).toBe(0);
      expect(screen.getByRole("button", { name: "1か月進める" })).toBeEnabled();
    },
  );
});
