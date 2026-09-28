import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { policyStateHash } from "../application/policy-view";
import { createGame, type GameRepository } from "../application/game-service";
import { App } from "./App";
import { Developer } from "./Operations";

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

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
  it("opens budget, market, and help without changing state or exposing development tools", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "operations-read-only");
    const before = structuredClone(memory.saved);
    render(<App repository={memory.repository} />);

    fireEvent.click(await screen.findByRole("button", { name: "予算" }));
    expect(screen.getByRole("heading", { name: "予算" })).toHaveFocus();
    expect(
      screen.getByRole("region", { name: "財政の主要指標" }),
    ).toHaveTextContent("政府債務");
    expect(
      screen.getByText("現在政策を続けた12か月見通し"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("-1.8%", { exact: false }).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "市場" }));
    expect(screen.getByRole("heading", { name: "市場" })).toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "海外金利" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "経常収支" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "因果ログで要因を見る" }),
    );
    expect(screen.getByRole("heading", { name: "経済レポート" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "ヘルプ・設定" }));
    expect(
      screen.getByText(/現実経済の予測ではありません/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開発者" })).toBeNull();
    expect(memory.saved).toEqual(before);
  });

  it("renders reproducible developer diagnostics from state", async () => {
    const memory = memoryRepository();
    const state = await createGame(memory.repository, "developer-diagnostics");
    render(<Developer state={state} />);

    expect(screen.getByText("developer-diagnostics")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "現在の乱数ストリーム" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "予約中・実行中の効果キュー" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "当月の保存済み寄与" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("非有限値（NaN / Infinity）: 0件"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/npm run simulate -- --ticks 96/),
    ).toBeInTheDocument();
  });

  it("persists an explanation-mode change from Help", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "help-settings", 1, "standard");
    render(<App repository={memory.repository} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "ヘルプ・設定" }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "説明モード" }), {
      target: { value: "learning" },
    });

    await waitFor(() => expect(memory.saved?.learningMode).toBe("learning"));
    expect(
      screen.getByText("説明モードを端末に保存しました。"),
    ).toBeInTheDocument();
  });

  it("shows empty launch history and offline usage guidance", async () => {
    const memory = memoryRepository();
    render(<App repository={memory.repository} />);

    fireEvent.click(await screen.findByRole("button", { name: "保存履歴" }));
    expect(
      screen.getByText("保存された国家運営はまだありません。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "遊び方・設定" }));
    expect(
      screen.getByText(/ログインや通信を必要としません/),
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
    fireEvent.click(screen.getByRole("button", { name: /港湾 安定/ }));
    expect(
      screen.getByRole("region", { name: "港湾の地域詳細" }),
    ).toHaveTextContent("輸出（月間）");
    fireEvent.click(
      screen.getByRole("button", { name: "経済レポートで理由を見る" }),
    );
    expect(screen.getByRole("heading", { name: "経済レポート" })).toHaveFocus();
    expect(memory.saved?.runState).toBe("paused");
  });

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
      screen.getByRole("heading", { name: "最大変化要因" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "首席補佐官の提案" }),
    ).toBeInTheDocument();
    expect(screen.getByText("48月目：シナリオ終了")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "政策を考える" }));
    expect(screen.getByText(/残り 3 \/ 3枠/)).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "政策金利の設定値" }),
      { target: { value: "0.05" } },
    );
    fireEvent.click(screen.getAllByRole("checkbox", { name: /中央銀行/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "1年・5年を比較する" }));
    expect(
      await screen.findByRole("heading", { name: "政策プレビュー" }),
    ).toHaveFocus();
    expect(screen.getAllByText(/固定ショック分位/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "反実仮想：別の判断なら" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "政策案と無介入の比較" }),
    ).toHaveTextContent("何もしない");
    expect(
      screen.getByRole("heading", { name: "1年・5年の見通し" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "マクロ経済" }),
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "政策を確定して保存" });
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
      screen.getByRole("heading", { name: "なぜ起きた" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "経済学ノート" }),
    ).toBeInTheDocument();
    expect(
      memory.saved?.history.learningEntries?.map((item) => item.kind),
    ).toEqual(["term", "theory", "decision", "verification"]);
    expect(
      screen.getAllByRole("heading", { name: "経済ニュース" }).length,
    ).toBeGreaterThan(0);
  });

  it("keeps a draft pending when durable save fails", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "ui-save-failure");
    render(<App repository={memory.repository} />);
    fireEvent.click(await screen.findByRole("button", { name: "政策会議" }));
    fireEvent.click(screen.getByRole("button", { name: "1年・5年を比較する" }));
    await screen.findByRole("heading", { name: "政策プレビュー" });
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
