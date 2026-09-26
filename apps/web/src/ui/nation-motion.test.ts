import { describe, expect, it } from "vitest";
import { createGame, type GameRepository } from "../application/game-service";
import { selectNationView } from "../application/nation-view";
import {
  advanceSprite,
  createSpritePool,
  initialQualityTier,
  nextQualityTier,
  visibleCount,
  MOTION_WIDTH,
} from "./nation-motion";

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
  it("keeps a fixed pool while quality reduces people and traffic without changing region data", async () => {
    const view = await model();
    const pool = createSpritePool();
    expect(pool.length).toBe(23);
    expect(visibleCount("person", view, "high")).toBeGreaterThan(0);
    expect(visibleCount("person", view, "low")).toBe(0);
    expect(visibleCount("car", view, "low")).toBeGreaterThan(0);
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
});
