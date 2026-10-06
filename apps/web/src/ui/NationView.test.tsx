import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame, type GameRepository } from "../application/game-service";
import { NationView } from "./NationView";

vi.mock("./NationMotion", () => ({
  NationMotion: ({ sceneAvailable }: { sceneAvailable: boolean }) => (
    <span
      data-testid="nation-motion-gate"
      data-scene-available={sceneAvailable}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function game() {
  const repository: GameRepository = {
    async load() {
      return null;
    },
    async save() {},
    async create() {},
  };
  return createGame(repository, "nation-detail-screen");
}

describe("NationView detail navigation", () => {
  it("keeps five primary indicators visible and returns focus to the selected region", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    const state = await game();
    const before = structuredClone(state);
    const onReport = vi.fn();
    render(<NationView state={state} onReport={onReport} />);
    const indicators = screen.getByRole("group", { name: "国家の主要指標" });
    expect(indicators.querySelectorAll(".nation-score")).toHaveLength(5);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const harbor = screen.getByRole("button", { name: /港湾の様子を見る/ });
    fireEvent.click(harbor);
    expect(screen.getByRole("dialog", { name: "地域の様子" })).toBeVisible();
    expect(indicators).toBeVisible();
    expect(screen.getByRole("button", { name: "詳細を閉じる" })).toHaveFocus();
    fireEvent.click(
      screen.getByRole("button", { name: "経済レポートで理由を見る" }),
    );
    expect(onReport).toHaveBeenCalledOnce();

    // A shell notification can open above this nonmodal details screen.
    // Escape in that separate dialog must leave the region selection intact.
    const notification = document.createElement("button");
    document.body.append(notification);
    fireEvent.keyDown(notification, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "地域の様子" })).toBeVisible();
    notification.remove();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(harbor).toHaveFocus());
    expect(harbor).toHaveAttribute("aria-pressed", "true");
    expect(state).toEqual(before);
  });

  it("preserves all region controls after an image failure and restores the details opener", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    const state = { ...(await game()), runState: "crisisStopped" as const };
    render(<NationView state={state} onReport={vi.fn()} />);
    expect(screen.getByTestId("nation-motion-gate")).toHaveAttribute(
      "data-scene-available",
      "false",
    );
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByTestId("nation-motion-gate")).toHaveAttribute(
      "data-scene-available",
      "false",
    );
    expect(
      screen.getByRole("img", { name: /都市、農村、工業、港湾/ }),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "国家の主要指標" })).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /出来事の詳細：危機への対応を待っています/,
      }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /の様子を見る：/ }),
    ).toHaveLength(7);

    const news = screen.getByRole("button", { name: "ニュース" });
    fireEvent.click(news);
    expect(screen.getByLabelText("見たい内容")).toHaveValue("news");
    fireEvent.change(screen.getByLabelText("見たい内容"), {
      target: { value: "regions" },
    });
    expect(screen.getByRole("dialog", { name: "地域一覧" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "詳細を閉じる" }));
    await waitFor(() => expect(news).toHaveFocus());
  });

  it("starts the image-aligned scene only after the artwork has loaded", async () => {
    render(<NationView state={await game()} onReport={vi.fn()} />);
    const image = screen.getByRole("img");
    const motion = screen.getByTestId("nation-motion-gate");
    expect(motion).toHaveAttribute("data-scene-available", "false");
    fireEvent.load(image);
    expect(motion).toHaveAttribute("data-scene-available", "true");
  });
});
