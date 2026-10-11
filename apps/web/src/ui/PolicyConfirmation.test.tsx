import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState, PolicyDecision } from "@macro-nation/domain";
import { createGame, type GameRepository } from "../application/game-service";
import { createReservedPolicy } from "../application/policy-view";
import { policyConfirmationContent } from "./PolicyConfirmation";

let initial: GameState;
beforeAll(async () => {
  const repository: GameRepository = {
    async load() {
      return null;
    },
    async create() {},
    async save() {},
  };
  initial = await createGame(repository, "confirmation-copy", 1, "casual");
});
afterEach(cleanup);

function withPolicy(policy: PolicyDecision): GameState {
  return {
    ...initial,
    policies: { ...initial.policies, reserved: [policy] },
  };
}
function savedPolicy(): PolicyDecision {
  return createReservedPolicy(
    initial,
    "interest-rate",
    0.05,
    "saved-policy",
    1,
  );
}

describe("saved policy confirmation", () => {
  it.each([
    ["interestRate", 0.05, "政策金利", "5%"],
    ["taxPackage", -0.02, "税制", "-2ポイント"],
    ["publicWorks", 0.03, "公共事業", "3%"],
    ["tariff", 0.1, "関税", "10%"],
    ["fxIntervention", -0.01, "為替介入", "-1%"],
  ] as const)(
    "keeps the saved %s setting in the input's display units",
    (type, value, name, setting) => {
      const state = withPolicy({ ...savedPolicy(), type, inputs: { value } });
      render(policyConfirmationContent({ state, onOpenReport: vi.fn() }));
      const panel = screen.getByRole("region", { name: "確定した政策" });
      expect(panel).toHaveTextContent(name);
      expect(panel).toHaveTextContent(setting);
      expect(panel).toHaveTextContent("開始予定：4月目");
      expect(panel).toHaveTextContent("開始待ち（予約中）");
    },
  );

  it("does not invent a setting for an old save that lacks inputs", () => {
    const legacy = { ...savedPolicy() };
    delete legacy.inputs;
    const state = withPolicy(legacy);
    render(policyConfirmationContent({ state, onOpenReport: vi.fn() }));
    expect(
      screen.getByRole("region", { name: "確定した政策" }),
    ).toHaveTextContent("このセーブには設定値が記録されていません");
    expect(
      screen.getByRole("region", { name: "確定した政策" }),
    ).not.toHaveTextContent("5%");
  });

  it("shows the saved active state without claiming its effect has already appeared", () => {
    const policy = { ...savedPolicy(), status: "active" as const };
    const state: GameState = {
      ...initial,
      policies: { ...initial.policies, active: [policy] },
    };
    render(policyConfirmationContent({ state, onOpenReport: vi.fn() }));
    const panel = screen.getByRole("region", { name: "確定した政策" });
    expect(panel).toHaveTextContent("開始月：4月目。状態：実施中");
    expect(panel).not.toHaveTextContent("開始待ち");
    expect(panel).toHaveTextContent(
      "開始と効果が表れる時期には時間差があります",
    );
  });

  it("keeps a cancelled reservation's planned month distinct from actual activation", () => {
    const policy = { ...savedPolicy(), status: "cancelled" as const };
    const state: GameState = {
      ...initial,
      policies: { ...initial.policies, cancelled: [policy] },
    };
    render(policyConfirmationContent({ state, onOpenReport: vi.fn() }));
    const panel = screen.getByRole("region", { name: "確定した政策" });
    expect(panel).toHaveTextContent("取消前の開始予定：4月目。状態：取消済み");
    expect(panel).not.toHaveTextContent("開始月：");
    expect(panel).not.toHaveTextContent("確定した時点では発動していません");
  });

  it.each([
    ["awaitingEvent", "まずホームでイベントへの対応を選んでください"],
    ["crisisStopped", "まず緊急会議で危機への対応を確認してください"],
    ["completed", "運営は終了しています"],
    ["failed", "運営は終了しています"],
  ] as const)(
    "respects the %s blocker before giving a progression instruction",
    (runState, guidance) => {
      const state = { ...withPolicy(savedPolicy()), runState };
      render(policyConfirmationContent({ state, onOpenReport: vi.fn() }));
      const panel = screen.getByRole("region", { name: "確定した政策" });
      expect(panel).toHaveTextContent(guidance);
      expect(panel).not.toHaveTextContent(
        "「1か月進める」で月を進めてください",
      );
      expect(panel).not.toHaveTextContent("「再開」（初回は");
    },
  );

  it("opens the result report without changing the saved policy or clock", () => {
    const state = withPolicy(savedPolicy());
    const before = structuredClone(state);
    const onOpenReport = vi.fn();
    render(policyConfirmationContent({ state, onOpenReport }));
    fireEvent.click(
      screen.getByRole("button", { name: "レポートで結果を見る" }),
    );
    expect(onOpenReport).toHaveBeenCalledOnce();
    expect(state).toEqual(before);
  });
});
