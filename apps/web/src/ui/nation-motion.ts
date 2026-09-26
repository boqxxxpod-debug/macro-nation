import type { NationViewModel, VisualStage } from "../application/nation-view";

export type QualityTier = "high" | "medium" | "low";
export type SpriteKind =
  "car" | "train" | "ship" | "plane" | "person" | "crane" | "light" | "cloud";

export interface Sprite {
  readonly kind: SpriteKind;
  readonly lane: number;
  readonly speed: number;
  x: number;
}

export const MOTION_WIDTH = 1000;
export const MOTION_HEIGHT = 1389;
const ICON_SIZE = 32;
const KINDS: readonly SpriteKind[] = [
  "car",
  "train",
  "ship",
  "plane",
  "person",
  "crane",
  "light",
  "cloud",
];

const CAPACITY: Record<SpriteKind, number> = {
  car: 4,
  train: 1,
  ship: 3,
  plane: 2,
  person: 5,
  crane: 1,
  light: 4,
  cloud: 3,
};
const LANES: Record<SpriteKind, number> = {
  car: 930,
  train: 825,
  ship: 1150,
  plane: 1090,
  person: 675,
  crane: 510,
  light: 655,
  cloud: 85,
};
const SPEED: Record<SpriteKind, number> = {
  car: 28,
  train: 22,
  ship: 13,
  plane: 52,
  person: 7,
  crane: 0,
  light: 0,
  cloud: 3,
};

/** Objects are allocated once and reused; frame updates never create sprites. */
export function createSpritePool(): Sprite[] {
  return KINDS.flatMap((kind) =>
    Array.from({ length: CAPACITY[kind] }, (_, index) => ({
      kind,
      lane: LANES[kind] + (index % 2) * 12,
      speed: SPEED[kind] * (index % 2 ? -1 : 1),
      x: [110, 350, 620, 830, 510][index]!,
    })),
  );
}

export function initialQualityTier(
  cores?: number,
  memoryGb?: number,
): QualityTier {
  if (
    (cores !== undefined && cores <= 2) ||
    (memoryGb !== undefined && memoryGb <= 2)
  )
    return "low";
  if (
    (cores !== undefined && cores <= 4) ||
    (memoryGb !== undefined && memoryGb <= 4)
  )
    return "medium";
  return "high";
}

const clampCount = (level: VisualStage, maximum: number) =>
  Math.min(maximum, Math.max(0, level + 1));

export function visibleCount(
  kind: SpriteKind,
  model: NationViewModel,
  tier: QualityTier,
): number {
  const levels: Record<SpriteKind, VisualStage> = {
    car: model.regions.transport.stage,
    train: model.regions.transport.stage,
    ship: model.regions.harbor.stage,
    plane: model.regions.airport.stage,
    person: model.regions.city.stage,
    crane: model.constructionLevel,
    light: model.regions.city.stage,
    cloud: model.weatherKey === "alert" ? 3 : 0,
  };
  const level = levels[kind];
  if (kind === "crane") return level >= 2 ? 1 : 0;
  if (kind === "train") return level >= 1 ? 1 : 0;
  if (kind === "light")
    return model.timeOfDay === "night" ? clampCount(level, CAPACITY[kind]) : 0;
  const full = clampCount(level, CAPACITY[kind]);
  if (tier === "high") return full;
  if (tier === "low" && (kind === "person" || kind === "cloud")) return 0;
  if (tier === "medium" && kind === "person") return Math.ceil(full / 2);
  return Math.max(1, Math.ceil(full / (tier === "low" ? 3 : 2)));
}

export function advanceSprite(sprite: Sprite, elapsedSeconds: number) {
  sprite.x += sprite.speed * Math.min(0.1, Math.max(0, elapsedSeconds));
  if (sprite.x > MOTION_WIDTH + ICON_SIZE) sprite.x = -ICON_SIZE;
  if (sprite.x < -ICON_SIZE) sprite.x = MOTION_WIDTH + ICON_SIZE;
}

/** One tiny atlas is shared by every sprite; no external image requests. */
export function createSpriteAtlas(): HTMLCanvasElement {
  const atlas = document.createElement("canvas");
  atlas.width = ICON_SIZE * KINDS.length;
  atlas.height = ICON_SIZE;
  const ctx = atlas.getContext("2d");
  if (!ctx) return atlas;
  KINDS.forEach((kind, index) => {
    const x = index * ICON_SIZE;
    ctx.save();
    ctx.translate(x, 0);
    if (kind === "car" || kind === "train") {
      ctx.fillStyle = kind === "car" ? "#db8054" : "#ece6d4";
      ctx.fillRect(2, 12, kind === "car" ? 26 : 30, 11);
      ctx.fillStyle = "#345b69";
      ctx.fillRect(7, 23, 5, 4);
      ctx.fillRect(23, 23, 5, 4);
    } else if (kind === "ship") {
      ctx.fillStyle = "#f5e8c5";
      ctx.beginPath();
      ctx.moveTo(0, 18);
      ctx.lineTo(31, 18);
      ctx.lineTo(23, 27);
      ctx.lineTo(6, 27);
      ctx.fill();
    } else if (kind === "plane") {
      ctx.fillStyle = "#f8f4df";
      ctx.beginPath();
      ctx.moveTo(30, 13);
      ctx.lineTo(4, 7);
      ctx.lineTo(10, 15);
      ctx.lineTo(4, 24);
      ctx.fill();
    } else if (kind === "person") {
      ctx.fillStyle = "#234e5b";
      ctx.beginPath();
      ctx.arc(16, 10, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(12, 16, 8, 14);
    } else if (kind === "cloud") {
      ctx.fillStyle = "rgba(255,255,255,.72)";
      [10, 18, 24].forEach((cx) => {
        ctx.beginPath();
        ctx.arc(cx, 18, 8, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      ctx.fillStyle = kind === "light" ? "#ffe6a0" : "#f3b875";
      ctx.fillRect(12, kind === "light" ? 12 : 4, 9, kind === "light" ? 9 : 27);
    }
    ctx.restore();
  });
  return atlas;
}

export function drawMotionFrame(
  context: CanvasRenderingContext2D,
  atlas: HTMLCanvasElement,
  sprites: readonly Sprite[],
  model: NationViewModel,
  tier: QualityTier,
  elapsedSeconds: number,
) {
  context.clearRect(0, 0, MOTION_WIDTH, MOTION_HEIGHT);
  const drawn: Record<SpriteKind, number> = {
    car: 0,
    train: 0,
    ship: 0,
    plane: 0,
    person: 0,
    crane: 0,
    light: 0,
    cloud: 0,
  };
  for (const sprite of sprites) {
    if (drawn[sprite.kind] >= visibleCount(sprite.kind, model, tier)) continue;
    drawn[sprite.kind] += 1;
    advanceSprite(sprite, elapsedSeconds);
    context.drawImage(
      atlas,
      KINDS.indexOf(sprite.kind) * ICON_SIZE,
      0,
      ICON_SIZE,
      ICON_SIZE,
      sprite.x,
      sprite.lane,
      ICON_SIZE,
      ICON_SIZE,
    );
  }
}

/** Capped at 30 drawn frames per second; one low sample steps down the density. */
export function nextQualityTier(
  tier: QualityTier,
  measuredFps: number,
): QualityTier {
  if (measuredFps >= 20) return tier;
  return tier === "high" ? "medium" : "low";
}
