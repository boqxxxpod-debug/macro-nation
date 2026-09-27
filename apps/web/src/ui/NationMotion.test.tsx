import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
    let intersectionChanged: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    class FakeIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionChanged = callback;
      }
      observe() {}
      disconnect() {
        disconnect();
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
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
    expect(screen.getByText(/性能を計測中/)).toHaveAttribute(
      "data-performance",
      "measuring",
    );

    intersectionChanged?.(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(cancel).toHaveBeenCalledWith(7);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(cancel).toHaveBeenCalledWith(7);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    vi.unstubAllGlobals();
  });

  it("does not count time spent hidden as a slow frame-rate sample", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      value: 8,
    });
    Object.defineProperty(navigator, "deviceMemory", {
      configurable: true,
      value: 8,
    });
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
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
      frames.delete(frameId);
    });

    render(<NationMotion model={await model()} />);
    const runNextFrame = (time: number) => {
      const entry = frames.entries().next().value as
        [number, FrameRequestCallback] | undefined;
      expect(entry).toBeDefined();
      frames.delete(entry![0]);
      entry![1](time);
    };
    await act(async () => {
      runNextFrame(100);
      runNextFrame(1_100);
    });

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => runNextFrame(100_000));

    expect(
      document.querySelector("canvas.nation-motion-canvas"),
    ).toHaveAttribute("data-quality", "high");
    expect(screen.getByText(/性能を計測中/)).toHaveAttribute(
      "data-performance",
      "measuring",
    );
    vi.unstubAllGlobals();
  });

  it("automatically lowers drawing quality when measured frame rate misses the minimum", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      value: 8,
    });
    Object.defineProperty(navigator, "deviceMemory", {
      configurable: true,
      value: 8,
    });
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
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    render(<NationMotion model={await model()} />);
    expect(
      document.querySelector("canvas.nation-motion-canvas"),
    ).toHaveAttribute("data-quality", "high");

    await act(async () => {
      frames.shift()?.(34);
      frames.shift()?.(68);
      frames.shift()?.(2_100);
    });

    expect(
      document.querySelector("canvas.nation-motion-canvas"),
    ).toHaveAttribute("data-quality", "medium");
    expect(screen.getByText(/20fps未満・画質を調整中/)).toHaveAttribute(
      "data-performance",
      "slow",
    );
    vi.unstubAllGlobals();
  });

  it("reuses its fixed drawing resources across quality changes", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
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
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(8);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    render(<NationMotion model={await model()} />);
    const canvas = document.querySelector("canvas.nation-motion-canvas");
    expect(getContext).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByLabelText("景観の画質"), {
      target: { value: "low" },
    });

    expect(canvas).toHaveAttribute("data-quality", "low");
    // The visible canvas is reacquired by the restarted loop, but a second
    // off-DOM atlas is not allocated.
    expect(getContext).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("updates monthly state without restarting the animation loop", async () => {
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
      .mockReturnValue(12);
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const initialModel = await model();
    const { rerender } = render(<NationMotion model={initialModel} />);

    expect(request).toHaveBeenCalledTimes(1);
    rerender(
      <NationMotion
        model={{ ...initialModel, month: initialModel.month + 1 }}
      />,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
