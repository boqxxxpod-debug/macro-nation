import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { createGame, type GameRepository } from "../application/game-service";
import { TimeControls } from "./TimeControls";

afterEach(cleanup);

describe("clock warning controls", () => {
  it("shows processing visibly in the existing status row while controls are busy", async () => {
    const repository: GameRepository = {
      async load() {
        return null;
      },
      async create() {},
      async save() {},
    };
    const initial = await createGame(repository, "clock-busy-ui", 1, "casual");
    const state: GameState = {
      ...initial,
      runState: "running",
      clock: { ...initial.clock, progressionMode: "auto" },
    };
    const props = {
      state,
      remainingMs: 300_000,
      hasStarted: true,
      onModeChange() {},
      onStart() {},
      onPause() {},
      onManualStep() {},
    };
    const view = render(<TimeControls {...props} busy />);
    expect(screen.getByRole("status")).toHaveTextContent("計算・保存中");
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.getByRole("button", { name: "一時停止" })).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "時間の進め方" }),
    ).toBeDisabled();
    view.rerender(<TimeControls {...props} busy={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("進行中");
    expect(screen.getByRole("button", { name: "一時停止" })).toBeEnabled();
  });

  it("explains suspended accrual without blocking an explicit pause and clears the notice after recovery", async () => {
    let saved: GameState | null = null;
    const repository: GameRepository = {
      async load() {
        return saved;
      },
      async create(state) {
        saved = state;
      },
      async save(_expected, state) {
        saved = state;
      },
    };
    const initial = await createGame(
      repository,
      "clock-warning-ui",
      1,
      "casual",
    );
    const state: GameState = {
      ...initial,
      runState: "running",
      clock: {
        ...initial.clock,
        progressionMode: "auto",
        warning: "CLOCK_MOVED_BACKWARD",
      },
    };
    const props = {
      remainingMs: 300_000,
      busy: false,
      hasStarted: true,
      onModeChange() {},
      onStart() {},
      onPause() {},
      onManualStep() {},
    };
    const view = render(<TimeControls {...props} state={state} />);
    expect(screen.getByText("時刻の調整待ち")).toBeInTheDocument();
    expect(screen.getByText(/端末の時刻が保存時より前/)).toHaveTextContent(
      "一時停止してから再開",
    );
    expect(screen.getByRole("button", { name: "一時停止" })).toBeEnabled();
    view.rerender(
      <TimeControls
        {...props}
        state={{
          ...initial,
          runState: "running",
          clock: { ...initial.clock, progressionMode: "auto" },
        }}
      />,
    );
    expect(
      screen.queryByText(/端末の時刻が保存時より前/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("進行中")).toBeInTheDocument();
  });
});
