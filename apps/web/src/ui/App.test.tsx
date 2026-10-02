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
    async load(slotId) {
      return saved?.slotId === slotId ? structuredClone(saved) : null;
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
    replace(state: GameState) {
      saved = structuredClone(state);
    },
    fail() {
      failSave = true;
    },
  };
}

describe("SCN-01 user journey", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /港湾 安定/ }));
    expect(
      screen.getByRole("region", { name: "港湾の地域詳細" }),
    ).toHaveTextContent("輸出（月間）");
    fireEvent.click(
      screen.getByRole("button", { name: "経済レポートで理由を見る" }),
    );
    expect(screen.getByRole("heading", { name: "経済レポート" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "国家ビューに戻る" }));
    expect(screen.getByRole("heading", { name: "国家ビュー" })).toHaveFocus();
    expect(policyStateHash(memory.saved!)).toBe(savedHash);
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
      await screen.findByRole("heading", { name: "国家ビュー" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ゲームを開始し、端末に保存しました。"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "国家ビュー" })).toHaveFocus(),
    );
    expect(window.location.pathname).toBe("/game/1/nation");
    fireEvent.click(screen.getByRole("button", { name: /経済指標を見る/ }));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(
      screen.getByRole("heading", { name: "最大変化要因" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "首席補佐官の提案" }),
    ).toBeInTheDocument();
    expect(screen.getByText("48月目：シナリオ終了")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "国家ビューに戻る" }));
    fireEvent.click(screen.getByRole("button", { name: /政策を考える/ }));
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
    await waitFor(() =>
      expect(
        screen.getAllByRole("heading", { name: "政策会議" })[0],
      ).toHaveFocus(),
    );
    expect(memory.saved?.policyAdministration?.receipts).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "国家ビューに戻る" }));
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
    await createGame(repository, "nation-slot-two", 2);
    window.history.replaceState({}, "", "/game/2");
    const { unmount } = render(<App repository={repository} />);
    await screen.findByRole("heading", { name: "国家ビュー" });
    expect(window.location.pathname).toBe("/game/2/nation");
    fireEvent.click(screen.getByRole("button", { name: "1か月進める" }));
    await screen.findByText(/まで進み、保存しました/);
    expect(saved.get(2)?.monthIndex).toBe(1);
    expect(saved.get(1)?.monthIndex).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /保存スロット/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "スロット2の続きから" }),
    );
    expect(screen.getByText(/スロット2 · 1年目 2月/)).toBeInTheDocument();
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
    expect(screen.getByText(/スロット2 · 1年目 2月/)).toBeInTheDocument();
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
        screen.getByRole("button", {
          name:
            status === "crisisStopped" ? "危機対応を確認して再開" : "均衡対応",
        }),
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
