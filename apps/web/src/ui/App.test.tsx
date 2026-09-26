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

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
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
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "国家ホーム" })).toHaveFocus(),
    );
    expect(screen.getAllByRole("article")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "政策を考える" }));
    expect(screen.getByText(/残り 3 \/ 3枠/)).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "政策金利の設定値" }),
      { target: { value: "0.05" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "12か月を比較する" }));
    expect(
      await screen.findByRole("heading", { name: "政策プレビュー" }),
    ).toHaveFocus();
    expect(screen.getAllByText(/固定ショック分位/).length).toBeGreaterThan(0);
    const button = screen.getByRole("button", { name: "政策を確定して保存" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(
      await screen.findByText("政策を確定し、端末に保存しました。"),
    ).toBeInTheDocument();
    expect(memory.saved?.policies.reserved).toHaveLength(1);
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
      screen.getByRole("heading", { name: "今月の主な原因" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "経済ニュース" }).length,
    ).toBeGreaterThan(0);
  });

  it("keeps a draft pending when durable save fails", async () => {
    const memory = memoryRepository();
    await createGame(memory.repository, "ui-save-failure");
    render(<App repository={memory.repository} />);
    fireEvent.click(await screen.findByRole("button", { name: "政策会議" }));
    fireEvent.click(screen.getByRole("button", { name: "12か月を比較する" }));
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
