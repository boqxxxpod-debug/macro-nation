import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { createGame, type GameRepository } from "../application/game-service";
import {
  monthlyEvidenceQuery,
  parseMonthlyEvidence,
  type MonthlyEvidenceTarget,
} from "../application/monthly-evidence";
import { policyStateHash } from "../application/policy-view";
import { App } from "./App";

let initial: GameState;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  // Use the real PageDeck, with enough jsdom space for two measured items.
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
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "issue-121-ending-navigation",
  );
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

function onPage(label: string, find: () => HTMLElement | null | undefined) {
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
  const candidates = screen.queryAllByRole(role, { name, hidden: true });
  return onPage(label, () =>
    candidates.find(
      (element) => element.isConnected && !element.closest("[hidden]"),
    ),
  );
}

function savedCauseOnPage(sourceId: string) {
  return onPage("経済レポート", () =>
    document.querySelector<HTMLElement>(`[data-report-cause="${sourceId}"]`),
  );
}

function memoryRepository(runState: "completed" | "failed") {
  const state: GameState = {
    ...initial,
    monthIndex: 48,
    runState,
    history: {
      ...initial.history,
      reports: [
        {
          monthIndex: 0,
          values: { exports: 25, governmentDebt: 1080 },
          topCauses: [],
          causalTrace: { completeness: "initial", indicators: [] },
        },
        {
          monthIndex: 47,
          values: { exports: 20, governmentDebt: 1069.84 },
          topCauses: [
            {
              indicatorId: "exports",
              sourceType: "external",
              sourceId: "external.export-demand",
              labelKey: "export.saved",
              delta: -0.5,
            },
          ],
          causalTrace: { completeness: "legacy-incomplete", indicators: [] },
        },
        {
          monthIndex: 48,
          values: { exports: 19, governmentDebt: 1081 },
          topCauses: [
            {
              indicatorId: "governmentDebt",
              sourceType: "accounting",
              sourceId: "fiscal.debt",
              labelKey: "debt.saved",
              delta: 11.16,
            },
          ],
          causalTrace: { completeness: "legacy-incomplete", indicators: [] },
        },
      ],
    },
  };
  // Model a persisted/reloaded save rather than sharing a mutable object with App.
  let saved: GameState = JSON.parse(JSON.stringify(state));
  const save = vi.fn(async (expected: string, next: GameState) => {
    if (expected !== policyStateHash(saved)) throw new Error("stale state");
    saved = JSON.parse(JSON.stringify(next));
  });
  const repository: GameRepository = {
    load: async (slotId) =>
      slotId === 1 ? JSON.parse(JSON.stringify(saved)) : null,
    create: async () => {
      throw new Error("slot occupied");
    },
    save,
  };
  return {
    repository,
    save,
    get saved() {
      return saved;
    },
  };
}

function expectEndingReportTarget(target: MonthlyEvidenceTarget) {
  expect(window.location.pathname).toBe("/game/1/report");
  const expected = new URLSearchParams(monthlyEvidenceQuery(target));
  expected.set("from", "ending");
  expect(new URLSearchParams(window.location.search)).toEqual(expected);
  expect(parseMonthlyEvidence(window.location.search)).toEqual(target);
  expect(
    screen.getByRole("button", { name: "終了評価へ戻る" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "ホームの報告へ戻る" }),
  ).not.toBeInTheDocument();
}

describe("ending report navigation", () => {
  it.each(["completed", "failed"] as const)(
    "keeps dated evidence, ending origin, and a %s save through selectors, history and reload",
    async (runState) => {
      const memory = memoryRepository(runState);
      const savedBefore = JSON.stringify(memory.saved);
      const hashBefore = policyStateHash(memory.saved);
      window.history.replaceState({}, "", "/game/1/ending");
      let mounted = render(<App repository={memory.repository} />);
      await screen.findByRole("heading", { name: "終了評価" });

      fireEvent.click(
        roleOnPage(
          "終了評価の詳細",
          "button",
          "輸出の月次記録を見る（47月目）",
        ),
      );
      await screen.findByRole("heading", { name: "経済レポート" });
      const exportsTarget: MonthlyEvidenceTarget = {
        monthIndex: 47,
        indicatorId: "exports",
        row: 0,
      };
      expectEndingReportTarget(exportsTarget);
      expect(savedCauseOnPage("external.export-demand")).toHaveTextContent(
        "輸出",
      );
      expect(
        document.querySelector('[data-report-cause="fiscal.debt"]'),
      ).toBeNull();

      mounted.unmount();
      mounted = render(<App repository={memory.repository} />);
      await screen.findByRole("heading", { name: "経済レポート" });
      expectEndingReportTarget(exportsTarget);
      expect(roleOnPage("経済レポート", "combobox", "報告の月")).toHaveValue(
        "47",
      );
      expect(roleOnPage("経済レポート", "combobox", "報告の指標")).toHaveValue(
        "exports",
      );

      fireEvent.change(roleOnPage("経済レポート", "combobox", "報告の指標"), {
        target: { value: "governmentDebt" },
      });
      expectEndingReportTarget({
        monthIndex: 47,
        indicatorId: "governmentDebt",
        row: 0,
      });
      expect(
        document.querySelector('[data-report-cause="external.export-demand"]'),
      ).toBeNull();
      expect(
        document.querySelector('[data-report-cause="fiscal.debt"]'),
      ).toBeNull();
      fireEvent.change(roleOnPage("経済レポート", "combobox", "報告の月"), {
        target: { value: "48" },
      });
      const debtTarget: MonthlyEvidenceTarget = {
        monthIndex: 48,
        indicatorId: "governmentDebt",
        row: 0,
      };
      expectEndingReportTarget(debtTarget);
      expect(savedCauseOnPage("fiscal.debt")).toHaveTextContent("11.16");

      window.history.back();
      await waitFor(() =>
        expect(parseMonthlyEvidence(window.location.search)).toEqual({
          monthIndex: 47,
          indicatorId: "governmentDebt",
          row: 0,
        }),
      );
      expectEndingReportTarget({
        monthIndex: 47,
        indicatorId: "governmentDebt",
        row: 0,
      });
      fireEvent.click(screen.getByRole("button", { name: "終了評価へ戻る" }));
      expect(window.location.pathname).toBe("/game/1/ending");
      await screen.findByRole("heading", { name: "終了評価" });

      fireEvent.click(
        roleOnPage("終了評価の詳細", "button", "最終月の要因をレポートで見る"),
      );
      await screen.findByRole("heading", { name: "経済レポート" });
      expectEndingReportTarget(debtTarget);
      expect(savedCauseOnPage("fiscal.debt")).toHaveTextContent("政府債務");
      expect(
        document.querySelector('[data-report-cause="external.export-demand"]'),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "すべての変化の理由を見る" }),
      );
      expect(window.location.search).toBe("?from=ending");
      expect(
        screen.getByRole("button", { name: "終了評価へ戻る" }),
      ).toBeInTheDocument();

      mounted.unmount();
      mounted = render(<App repository={memory.repository} />);
      await screen.findByRole("heading", { name: "経済レポート" });
      expect(window.location.search).toBe("?from=ending");
      fireEvent.click(screen.getByRole("button", { name: "終了評価へ戻る" }));
      await screen.findByRole("heading", { name: "終了評価" });
      expect(window.location.pathname).toBe("/game/1/ending");
      expect(memory.save).not.toHaveBeenCalled();
      expect(JSON.stringify(memory.saved)).toBe(savedBefore);
      expect(policyStateHash(memory.saved)).toBe(hashBefore);
      expect(memory.saved).toMatchObject({ runState, monthIndex: 48 });
      fireEvent.click(screen.getByRole("button", { name: "国家ビューに戻る" }));
      await screen.findByRole("heading", { name: "国家ビュー" });
      expect(
        screen.getByRole("button", { name: "1か月進める" }),
      ).toBeDisabled();
      mounted.unmount();
    },
    30_000,
  );
});
