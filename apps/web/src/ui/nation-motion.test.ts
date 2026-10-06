import { describe, expect, it, vi } from "vitest";
import { createGame, type GameRepository } from "../application/game-service";
import { selectNationView } from "../application/nation-view";
import {
  advanceSprite,
  createSpritePool,
  drawMotionFrame,
  drawStillFrame,
  frameRateStatus,
  initialQualityTier,
  nextQualityTier,
  visibleCount,
  MOTION_WIDTH,
  MOTION_HEIGHT,
  spritePose,
} from "./nation-motion";
import { MOTION_PATHS, sampleMotionPath } from "./nation-motion-paths";

async function model() {
  const repository: GameRepository = {
    async load() {
      return null;
    },
    async save() {},
    async create() {},
  };
  return selectNationView(await createGame(repository, "nation-motion-tier"));
}

describe("nation motion budget", () => {
  it("uses the source image coordinate system and artwork-aligned routes", () => {
    expect([MOTION_WIDTH, MOTION_HEIGHT]).toEqual([941, 1672]);
    for (const [id, points] of Object.entries(MOTION_PATHS)) {
      expect(points.length, id).toBeGreaterThan(1);
      for (const point of points) {
        expect(point.x, id).toBeGreaterThanOrEqual(-70);
        expect(point.x, id).toBeLessThanOrEqual(1010);
        expect(point.y, id).toBeGreaterThanOrEqual(0);
        expect(point.y, id).toBeLessThanOrEqual(MOTION_HEIGHT);
      }
    }
    expect(sampleMotionPath("rail", 0)).toMatchObject({ x: 100, y: 580 });
    expect(sampleMotionPath("rail", 1)).toMatchObject({ x: 680, y: 887 });
    const railway = sampleMotionPath("rail", 0.5);
    expect(railway.x).toBeGreaterThan(260);
    expect(railway.x).toBeLessThan(590);
    expect(railway.y).toBeGreaterThan(677);
    expect(railway.y).toBeLessThan(860);
  });

  it("turns vehicles with their paths and gives ships a genuine docking interval", () => {
    const pool = createSpritePool();
    const car = pool.find(
      (sprite) => sprite.kind === "car" && sprite.index === 0,
    )!;
    const reverse = pool.find(
      (sprite) => sprite.kind === "car" && sprite.index === 1,
    )!;
    car.x = 470;
    reverse.x = 470;
    const headingDifference = spritePose(reverse).angle - spritePose(car).angle;
    // The two road routes are distinct, while the reverse heading stays westbound.
    expect(Math.cos(spritePose(car).angle)).toBeGreaterThan(0);
    expect(Math.cos(spritePose(reverse).angle)).toBeLessThan(0);
    expect(Number.isFinite(headingDifference)).toBe(true);

    const bayShip = pool.find(
      (sprite) => sprite.kind === "ship" && sprite.index === 0,
    )!;
    expect(spritePose(bayShip).y).toBeLessThan(500);
    const ship = pool.find(
      (sprite) => sprite.kind === "ship" && sprite.index === 1,
    )!;
    ship.x = MOTION_WIDTH * 0.48;
    const docked = spritePose(ship);
    ship.x = MOTION_WIDTH * 0.6;
    expect(spritePose(ship)).toMatchObject({ x: docked.x, y: docked.y });

    const plane = pool.find(
      (sprite) => sprite.kind === "plane" && sprite.index === 0,
    )!;
    plane.x = MOTION_WIDTH * 0.7;
    const ground = spritePose(plane);
    plane.x = MOTION_WIDTH * 0.96;
    const airborne = spritePose(plane);
    expect(airborne.y).toBeLessThan(ground.y);
    expect(airborne.scale).toBeLessThan(ground.scale);
  });

  it("keeps the first ship in the visible bay at the lowest harbor stage and quality", async () => {
    const view = await model();
    const quietHarbor = {
      ...view,
      regions: {
        ...view.regions,
        harbor: { ...view.regions.harbor, stage: 0 as const },
      },
    };
    const firstShip = createSpritePool().find(
      (sprite) => sprite.kind === "ship" && sprite.index === 0,
    )!;
    expect(visibleCount("ship", quietHarbor, "low")).toBe(1);
    expect(spritePose(firstShip).y).toBeLessThan(1170);
    expect(spritePose(firstShip).x).toBeGreaterThan(790);
  });

  it("keeps a fixed pool while quality reduces people and traffic without changing region data", async () => {
    const view = await model();
    const pool = createSpritePool();
    expect(pool.length).toBe(23);
    expect(visibleCount("person", view, "high")).toBeGreaterThan(0);
    expect(visibleCount("person", view, "medium")).toBeLessThan(
      visibleCount("person", view, "high"),
    );
    expect(visibleCount("car", view, "medium")).toBe(
      visibleCount("car", view, "high"),
    );
    expect(visibleCount("person", view, "low")).toBe(0);
    expect(visibleCount("cloud", view, "low")).toBe(0);
    expect(visibleCount("car", view, "low")).toBeGreaterThan(0);
    expect(visibleCount("car", view, "low")).toBeLessThan(
      visibleCount("car", view, "medium"),
    );
    const sprite = pool[0]!;
    const initialX = sprite.x;
    advanceSprite(sprite, 0.05);
    expect(sprite).toBe(pool[0]);
    expect(sprite.x).not.toBe(initialX);
    expect(view.regions.city.value).toBe(100);
    sprite.x = MOTION_WIDTH + 32;
    advanceSprite(sprite, 0.05);
    expect(sprite.x).toBe(-32);
  });

  it("selects a lighter tier for a four-gigabyte device and steps down after a slow sample", () => {
    expect(initialQualityTier(4, 4)).toBe("medium");
    expect(initialQualityTier(2, 8)).toBe("low");
    expect(nextQualityTier("high", 18)).toBe("medium");
    expect(nextQualityTier("medium", 18)).toBe("low");
    expect(nextQualityTier("medium", 25)).toBe("medium");
  });

  it("classifies the documented target and minimum frame-rate boundaries", () => {
    expect(frameRateStatus(null)).toBe("measuring");
    expect(frameRateStatus(30)).toBe("target");
    expect(frameRateStatus(29)).toBe("minimum");
    expect(frameRateStatus(20)).toBe("minimum");
    expect(frameRateStatus(19)).toBe("slow");
  });

  it("reuses the same fixed pool during a long-running draw sequence", async () => {
    const view = await model();
    const pool = createSpritePool();
    const identities = [...pool];
    const context = {
      clearRect() {},
      drawImage() {},
    } as unknown as CanvasRenderingContext2D;
    const atlas = {} as HTMLCanvasElement;

    for (let frame = 0; frame < 10_000; frame += 1) {
      drawMotionFrame(context, atlas, pool, view, "high", 1 / 30);
    }

    expect(pool).toHaveLength(23);
    expect(pool.every((sprite, index) => sprite === identities[index])).toBe(
      true,
    );
  });

  it("keeps the confirmed view model intact and consumes no game randomness", async () => {
    const view = await model();
    const original = JSON.stringify(view);
    const sprites = createSpritePool();
    const context = {
      clearRect() {},
      drawImage() {},
    } as unknown as CanvasRenderingContext2D;
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("drawing must not use the game random stream");
    });
    try {
      for (const tier of ["high", "medium", "low"] as const)
        drawMotionFrame(
          context,
          {} as HTMLCanvasElement,
          sprites,
          view,
          tier,
          1 / 30,
        );
    } finally {
      random.mockRestore();
    }
    expect(JSON.stringify(view)).toBe(original);
  });

  it("keeps night lighting as a still state cue without advancing motion", async () => {
    const view = await model();
    const night = { ...view, timeOfDay: "night" as const };
    const sprites = createSpritePool();
    const positions = sprites.map((sprite) => [sprite.x, sprite.phase]);
    const fillRect = vi.fn();
    const context = {
      globalAlpha: 1,
      clearRect: vi.fn(),
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      fillRect,
      arc() {},
    } as unknown as CanvasRenderingContext2D;
    drawStillFrame(context, sprites, night, "low");
    expect(fillRect).toHaveBeenCalledWith(430, 629, 3, 5);
    expect(sprites.map((sprite) => [sprite.x, sprite.phase])).toEqual(
      positions,
    );
    fillRect.mockClear();
    drawStillFrame(context, sprites, { ...night, timeOfDay: "day" }, "low");
    expect(fillRect).not.toHaveBeenCalledWith(430, 629, 3, 5);
  });

  it("keeps a multi-car train in one pool object and does not reset positions on a model change", async () => {
    const view = await model();
    const train = createSpritePool().find((sprite) => sprite.kind === "train")!;
    train.x = MOTION_WIDTH * 0.65;
    const drawImage = vi.fn();
    const context = {
      globalAlpha: 1,
      clearRect: vi.fn(),
      drawImage,
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      fillRect() {},
      arc() {},
      ellipse() {},
    } as unknown as CanvasRenderingContext2D;
    const atlas = {} as HTMLCanvasElement;
    drawMotionFrame(context, atlas, [train], view, "high", 1 / 30);
    expect(drawImage).toHaveBeenCalledTimes(4);
    const afterFirst = train.x;
    drawMotionFrame(
      context,
      atlas,
      [train],
      { ...view, month: view.month + 1, timeOfDay: "night" },
      "low",
      1 / 30,
    );
    expect(train.x).toBeGreaterThan(afterFirst);
    expect(train).toHaveProperty("index", 0);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 941, 1672);
  });

  it("fades construction activity across a monthly stage change without replacing its pool", async () => {
    const view = await model();
    const sprites = createSpritePool();
    const crane = sprites.find((sprite) => sprite.kind === "crane")!;
    const alphas: number[] = [];
    const stack: number[] = [];
    let canvasAlpha = 1;
    const surface = {
      get globalAlpha() {
        return canvasAlpha;
      },
      set globalAlpha(value: number) {
        canvasAlpha = value;
      },
      clearRect() {},
      drawImage() {},
      save() {
        stack.push(canvasAlpha);
      },
      restore() {
        canvasAlpha = stack.pop() ?? 1;
      },
      translate() {},
      rotate() {},
      scale() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      fillRect(x: number, y: number) {
        if (x > 540 && x < 610 && y > 490 && y < 550) alphas.push(canvasAlpha);
      },
      arc() {},
      ellipse() {},
    } as unknown as CanvasRenderingContext2D;
    const quiet = {
      ...view,
      constructionLevel: 0 as const,
      regions: {
        ...view.regions,
        harbor: { ...view.regions.harbor, stage: 0 as const },
      },
    };
    const active = { ...quiet, constructionLevel: 3 as const };
    drawMotionFrame(surface, {} as HTMLCanvasElement, sprites, quiet, "low", 0);
    expect(alphas).toHaveLength(0);

    drawMotionFrame(
      surface,
      {} as HTMLCanvasElement,
      sprites,
      active,
      "low",
      1 / 30,
    );
    const first = alphas.at(-1)!;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.8);
    for (let frame = 0; frame < 20; frame += 1)
      drawMotionFrame(
        surface,
        {} as HTMLCanvasElement,
        sprites,
        active,
        "low",
        0.1,
      );
    const settled = alphas.at(-1)!;
    expect(settled).toBeGreaterThan(first);

    drawMotionFrame(
      surface,
      {} as HTMLCanvasElement,
      sprites,
      quiet,
      "low",
      0.1,
    );
    const fading = alphas.at(-1)!;
    expect(fading).toBeLessThan(settled);
    expect(fading).toBeGreaterThan(0);
    expect(sprites.find((sprite) => sprite.kind === "crane")).toBe(crane);
  });
});
