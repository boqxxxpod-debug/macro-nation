import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createGame } from "../application/game-service";
import { tutorialContent } from "./tutorial-content";

afterEach(cleanup);
describe("shared four-quarter instructions", () => {
  it("uses the saved policy cycle and retains the existing tutorial boundary", async () => {
    const initial = await createGame(
      { load: async () => null, create: async () => {}, save: async () => {} },
      "issue-103-tutorial",
    );
    const state = {
      ...initial,
      monthIndex: 2,
      clock: {
        ...initial.clock,
        config: { ...initial.clock.config, policyCycleSteps: 2 },
      },
    };
    const before = structuredClone(state);
    render(tutorialContent(state));
    expect(
      screen.getByRole("heading", { name: "はじめの4四半期・第2回" }),
    ).toBeVisible();
    expect(
      screen.getByText("数か月進め、前月比と3行報告を確認しましょう。"),
    ).toBeVisible();
    expect(tutorialContent({ ...state, monthIndex: 8 })).toBeNull();
    expect(tutorialContent({ ...initial, monthIndex: 12 })).toBeNull();
    expect(tutorialContent({ ...initial, learningMode: "casual" })).toBeNull();
    expect(
      tutorialContent({ ...initial, learningMode: "standard" }),
    ).toBeNull();
    expect(state).toEqual(before);
  });
});
