import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame, type GameRepository } from "../application/game-service";
import { selectNationView } from "../application/nation-view";
import { NationMotion } from "./NationMotion";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function model() {
  const repository: GameRepository = {
    async load() {
      return null;
    },
    async save() {},
    async create() {},
  };
  return selectNationView(await createGame(repository, "motion-visibility"));
}

describe("NationMotion lifecycle", () => {
  it("does not start the animation loop when reduced motion is requested", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const request = vi
      .spyOn(window, "requestAnimationFrame")
      .mockReturnValue(1);
    const view = await model();
    const { container } = render(<NationMotion model={view} />);
    expect(container.querySelector("canvas.nation-motion-canvas")).toBeNull();
    expect(screen.getByText(/動きの軽減: 静止表示/)).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("stops on a hidden page and on screen exit", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const request = vi
      .spyOn(window, "requestAnimationFrame")
      .mockReturnValue(7);
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const view = await model();
    const { unmount } = render(<NationMotion model={view} />);
    expect(request).toHaveBeenCalled();
    expect(screen.getByLabelText("景観の画質")).toBeInTheDocument();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(cancel).toHaveBeenCalledWith(7);
    unmount();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    vi.unstubAllGlobals();
  });
});
