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
    name: `${label}：前のページ`,
  }) as HTMLButtonElement;
  while (!previous.disabled) fireEvent.click(previous);
  const next = within(deck).getByRole("button", {
    name: `${label}：次のページ`,
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
  let failSave = false;
  const repository: GameRepository = {
    async load() {
      return saved ? structuredClone(saved) : null;
    },
    async create(state) {
      if (saved) throw new Error("slot occupied");
      saved = structuredClone(state);
    },
    async save(expected, next) {
      if (failSave) throw new Error("storage unavailable");
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
    fail() {
      failSave = true;
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
      await screen.findByRole("heading", { name: "起動・保存スロット" });
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
    await screen.findByRole("heading", { name: "起動・保存スロット" });
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

    await screen.findByRole("heading", { name: "起動・保存スロット" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "ゲームを始める",
        }),
      ).toBeEnabled(),
    );
    fireEvent.click(roleOnPage("起動・開始設定", "button", "保存履歴"));
    expect(
      textOnPage("起動・開始設定", "保存された国家運営はまだありません。"),
    ).toBeInTheDocument();
    fireEvent.click(roleOnPage("起動・開始設定", "button", "遊び方・設定"));
    expect(
      textOnPage("起動・開始設定", /ログインや通信を必要としません/),
    ).toBeInTheDocument();
  });

  it("opens the nation view from home and reaches the same region from its DOM list", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "nation-view-accessibility");
    render(<App repository={memory.repository} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "国家の景観を見る" }),
    );
    expect(screen.getByRole("heading", { name: "国家ビュー" })).toHaveFocus();
    expect(window.location.pathname).toBe("/game/1/nation");
    fireEvent.click(screen.getByRole("button", { name: "地域一覧" }));
    fireEvent.click(roleOnPage("地域一覧", "button", /港湾 安定/));
    expect(textOnPage("地域詳細", /輸出（月間）/)).toBeInTheDocument();
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
    fireEvent.click(
      await screen.findByRole("button", { name: "ゲームを始める" }),
    );
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
      screen.getAllByRole("heading", { name: "最大変化要因" })[0],
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
    expect(textOnPage("次の節目", "48月目：シナリオ終了")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "政策を考える" }));
    expect(screen.getByText(/残り 3 \/ 3枠/)).toBeInTheDocument();
    fireEvent.change(roleOnPage("政策会議", "spinbutton", "政策金利の設定値"), {
      target: { value: "0.05" },
    });
    fireEvent.click(roleOnPage("政策会議", "checkbox", /中央銀行/));
    fireEvent.click(screen.getByRole("button", { name: "1年・5年を比較する" }));
    expect(
      await screen.findByRole("heading", { name: "政策プレビュー" }),
    ).toHaveFocus();
    expect(
      textOnPage("政策プレビュー", /固定ショック分位/),
    ).toBeInTheDocument();
    expect(
      roleOnPage("政策プレビュー", "heading", "反実仮想：別の判断なら"),
    ).toBeInTheDocument();
    expect(
      roleOnPage("政策プレビュー", "heading", "何もしない"),
    ).toBeInTheDocument();
    expect(
      roleOnPage("政策プレビュー", "heading", "1年・5年の見通し"),
    ).toBeInTheDocument();
    expect(
      roleOnPage("政策プレビュー", "heading", "マクロ経済"),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "政策を確定して保存" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(memory.saved?.policies.reserved).toHaveLength(0);
    fireEvent.click(
      roleOnPage(
        "政策プレビュー",
        "checkbox",
        "費用・副作用・警告を確認しました",
      ),
    );
    roleOnPage("政策プレビュー", "heading", "1年・5年の見通し");
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
    window.history.back();
    fireEvent.popState(window);
    expect(memory.saved?.policyAdministration?.receipts).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "ホーム" }));
    fireEvent.click(screen.getByRole("button", { name: "1か月進める" }));
    await waitFor(() => expect(memory.saved?.monthIndex).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "理由を見る" }));
    expect(screen.getByRole("heading", { name: "経済レポート" })).toHaveFocus();
    expect(
      roleOnPage("経済レポート", "heading", "なぜ起きた"),
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
    fireEvent.change(roleOnPage("政策会議", "combobox", "発動時期"), {
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
    expect(roleOnPage("政策会議", "combobox", "発動時期")).toHaveValue("2");
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
      roleOnPage("危機・イベント対応", "heading", "突発イベント：対応を選択"),
    ).toBeInTheDocument();
    expect(advance).toBeDisabled();
    fireEvent.click(roleOnPage("危機・イベント対応", "button", "均衡対応"));
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
    fireEvent.click(screen.getByRole("button", { name: "1年・5年を比較する" }));
    await screen.findByRole("heading", { name: "政策プレビュー" });
    fireEvent.click(
      roleOnPage(
        "政策プレビュー",
        "checkbox",
        "費用・副作用・警告を確認しました",
      ),
    );
    memory.fail();
    fireEvent.click(screen.getByRole("button", { name: "政策を確定して保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "storage unavailable",
    );
    expect(memory.saved?.policies.reserved).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "政策を確定して保存" }),
    ).toBeEnabled();
  });
});
