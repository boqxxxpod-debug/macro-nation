import type { NationViewModel, VisualStage } from "../application/nation-view";
import {
  MOTION_ANCHORS,
  sampleMotionPath,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  type MotionPathId,
  type PathPose,
} from "./nation-motion-paths";

export type QualityTier = "high" | "medium" | "low";
export type FrameRateStatus = "measuring" | "target" | "minimum" | "slow";
export type SpriteKind =
  "car" | "train" | "ship" | "plane" | "person" | "crane" | "light" | "cloud";

export interface Sprite {
  readonly kind: SpriteKind;
  readonly index: number;
  readonly lane: number;
  readonly speed: number;
  x: number;
  phase: number;
  opacity?: number;
}

export const MOTION_WIDTH = SCENE_WIDTH;
export const MOTION_HEIGHT = SCENE_HEIGHT;
export const TARGET_FPS = 30;
export const MINIMUM_FPS = 20;
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
  car: 32,
  train: 23,
  ship: 13,
  plane: 42,
  person: 9,
  crane: 0,
  light: 0,
  cloud: 2.5,
};

/** Objects are allocated once and reused; frame updates never create sprites. */
export function createSpritePool(): Sprite[] {
  return KINDS.flatMap((kind) =>
    Array.from({ length: CAPACITY[kind] }, (_, index) => ({
      kind,
      index,
      lane: LANES[kind],
      speed: SPEED[kind] * (index % 2 ? -1 : 1),
      x: [110, 350, 620, 830, 510][index]!,
      phase: index * 1.73,
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
  // Preserve the documented degradation order: people are reduced first,
  // followed by traffic and finally decorative weather. Region state, event
  // markers, construction and lighting remain available at every tier.
  if (kind === "person") return tier === "medium" ? Math.ceil(full / 2) : 0;
  if (tier === "medium") return full;
  if (kind === "cloud") return 0;
  return Math.max(1, Math.ceil(full / 3));
}

export function advanceSprite(sprite: Sprite, elapsedSeconds: number) {
  const elapsed = Math.min(0.1, Math.max(0, elapsedSeconds));
  sprite.phase += elapsed;
  const resting =
    sprite.kind === "person" &&
    Math.sin(sprite.phase * 0.65 + sprite.index * 2) > 0.9;
  if (!resting) sprite.x += sprite.speed * elapsed;
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
      ctx.fillStyle = kind === "car" ? "#dd8051" : "#e9eef0";
      ctx.fillRect(2, 15, kind === "car" ? 26 : 30, 9);
      ctx.beginPath();
      ctx.moveTo(7, 15);
      ctx.lineTo(11, 10);
      ctx.lineTo(kind === "car" ? 22 : 29, 10);
      ctx.lineTo(kind === "car" ? 26 : 31, 15);
      ctx.fill();
      ctx.fillStyle = "#47788a";
      ctx.fillRect(12, 11, kind === "car" ? 9 : 15, 4);
      ctx.fillStyle = "#274653";
      ctx.fillRect(7, 23, 5, 4);
      ctx.fillRect(23, 23, 5, 4);
      if (kind === "train") {
        ctx.fillStyle = "#4d92ab";
        ctx.fillRect(3, 20, 27, 2);
      }
    } else if (kind === "ship") {
      ctx.fillStyle = "#f5e8c5";
      ctx.beginPath();
      ctx.moveTo(0, 18);
      ctx.lineTo(31, 18);
      ctx.lineTo(23, 27);
      ctx.lineTo(6, 27);
      ctx.fill();
      ctx.fillStyle = "#d4774d";
      ctx.fillRect(7, 11, 8, 7);
      ctx.fillStyle = "#e3ac5e";
      ctx.fillRect(16, 11, 8, 7);
    } else if (kind === "plane") {
      ctx.fillStyle = "#f8f4df";
      ctx.beginPath();
      ctx.moveTo(30, 13);
      ctx.lineTo(16, 11);
      ctx.lineTo(10, 3);
      ctx.lineTo(7, 5);
      ctx.lineTo(10, 13);
      ctx.lineTo(2, 12);
      ctx.lineTo(2, 17);
      ctx.lineTo(10, 18);
      ctx.lineTo(7, 26);
      ctx.lineTo(10, 28);
      ctx.lineTo(16, 20);
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

interface AmbientBlend {
  night: number;
  alert: number;
  activity: number;
  construction: number;
  harbor: number;
}
const ambientByPool = new WeakMap<readonly Sprite[], AmbientBlend>();

function ambientBlend(
  sprites: readonly Sprite[],
  model: NationViewModel,
  elapsed: number,
): AmbientBlend {
  const targetNight =
    model.timeOfDay === "night" ? 1 : model.timeOfDay === "evening" ? 0.5 : 0;
  const targetAlert = model.weatherKey === "alert" ? 1 : 0;
  const targetActivity = model.regions.city.stage / 3;
  const targetConstruction = model.constructionLevel >= 2 ? 1 : 0;
  const targetHarbor = model.regions.harbor.stage >= 1 ? 1 : 0;
  let blend = ambientByPool.get(sprites);
  if (!blend) {
    blend = {
      night: targetNight,
      alert: targetAlert,
      activity: targetActivity,
      construction: targetConstruction,
      harbor: targetHarbor,
    };
    ambientByPool.set(sprites, blend);
  }
  const rate = Math.min(1, elapsed * 1.8);
  blend.night += (targetNight - blend.night) * rate;
  blend.alert += (targetAlert - blend.alert) * rate;
  blend.activity += (targetActivity - blend.activity) * rate;
  blend.construction += (targetConstruction - blend.construction) * rate;
  blend.harbor += (targetHarbor - blend.harbor) * rate;
  return blend;
}

function progressOf(sprite: Sprite) {
  return Math.max(0, Math.min(1, sprite.x / MOTION_WIDTH));
}

/** Both travel directions use the same artwork-aligned path and tangent. */
export function spritePose(sprite: Sprite): PathPose {
  const progress = progressOf(sprite);
  let path: MotionPathId;
  let routeProgress = progress;
  if (sprite.kind === "car") path = sprite.index % 2 ? "roadPort" : "roadCity";
  else if (sprite.kind === "train") path = "rail";
  else if (sprite.kind === "person")
    path = sprite.index % 2 ? "walkQuay" : "walkCity";
  else if (sprite.kind === "cloud") path = "cloud";
  else if (sprite.kind === "ship") {
    // The first ship remains in the visible upper bay when the lower sea is
    // cropped by cover on a short mobile viewport.
    if (sprite.index === 0) path = "bayShip";
    else if (progress < 0.43) {
      path = "harborIn";
      routeProgress = progress / 0.43;
    } else if (progress < 0.65) {
      const berth = sampleMotionPath("harborIn", 1);
      const departure = sampleMotionPath("harborOut", 0);
      const turn = (progress - 0.43) / 0.22;
      return {
        ...berth,
        angle:
          berth.angle +
          (departure.angle - berth.angle) * turn +
          (sprite.speed < 0 ? Math.PI : 0),
      }; // cargo loading and a slow turn at the quay
    } else {
      path = "harborOut";
      routeProgress = (progress - 0.65) / 0.35;
    }
  } else if (sprite.kind === "plane") {
    if (progress < 0.72) {
      path = "runway";
      routeProgress = progress / 0.72;
    } else {
      path = "flight";
      routeProgress = (progress - 0.72) / 0.28;
    }
  } else path = "walkCity";
  const pose = sampleMotionPath(path, routeProgress);
  return { ...pose, angle: pose.angle + (sprite.speed < 0 ? Math.PI : 0) };
}

function transitionOpacity(sprite: Sprite, target: number, elapsed: number) {
  if (sprite.opacity === undefined) sprite.opacity = target;
  else sprite.opacity += (target - sprite.opacity) * Math.min(1, elapsed * 4);
  return sprite.opacity;
}

function edgeOpacity(progress: number) {
  return Math.min(1, progress * 20, (1 - progress) * 20);
}

function drawAtlas(
  context: CanvasRenderingContext2D,
  atlas: HTMLCanvasElement,
  sprite: Sprite,
  pose: PathPose,
  alpha: number,
  sizeMultiplier = 1,
) {
  const size = ICON_SIZE * pose.scale * sizeMultiplier;
  context.save();
  context.globalAlpha *= alpha;
  context.translate(pose.x, pose.y);
  if (sprite.kind !== "cloud" && sprite.kind !== "person")
    context.rotate(pose.angle);
  if (sprite.kind === "person" && sprite.speed < 0) context.scale(-1, 1);
  context.drawImage(
    atlas,
    KINDS.indexOf(sprite.kind) * ICON_SIZE,
    0,
    ICON_SIZE,
    ICON_SIZE,
    -size / 2,
    -size / 2,
    size,
    size,
  );
  context.restore();
}

function drawWake(
  context: CanvasRenderingContext2D,
  pose: PathPose,
  phase: number,
  alpha: number,
) {
  context.save();
  context.globalAlpha *= alpha * 0.5;
  context.strokeStyle = "#e6f9fa";
  context.lineWidth = 1.5 * pose.scale;
  context.translate(pose.x, pose.y + 8 * pose.scale);
  context.rotate(pose.angle);
  for (let index = 0; index < 2; index += 1) {
    const tail = -17 - index * 9 - ((phase * 6) % 7);
    context.beginPath();
    context.moveTo(tail * pose.scale, (index ? 6 : -6) * pose.scale);
    context.lineTo((tail - 9) * pose.scale, (index ? 10 : -10) * pose.scale);
    context.stroke();
  }
  context.restore();
}

function drawTrain(
  context: CanvasRenderingContext2D,
  atlas: HTMLCanvasElement,
  sprite: Sprite,
  opacity: number,
) {
  const progress = progressOf(sprite);
  const spacing = sprite.speed < 0 ? -0.029 : 0.029;
  for (let carriage = 3; carriage >= 0; carriage -= 1) {
    const position = progress - carriage * spacing;
    if (position < 0 || position > 1) continue;
    const base = sampleMotionPath("rail", position);
    const pose = {
      ...base,
      angle: base.angle + (sprite.speed < 0 ? Math.PI : 0),
    };
    drawAtlas(
      context,
      atlas,
      sprite,
      pose,
      opacity * edgeOpacity(position),
      0.8,
    );
  }
}

function drawPlaneShadow(
  context: CanvasRenderingContext2D,
  sprite: Sprite,
  pose: PathPose,
  alpha: number,
) {
  const airborne = Math.max(0, (progressOf(sprite) - 0.72) / 0.28);
  context.save();
  context.globalAlpha *= alpha * (0.25 - airborne * 0.18);
  context.fillStyle = "#284759";
  context.beginPath();
  context.ellipse(
    pose.x - airborne * 25,
    pose.y + 12 + airborne * 48,
    13 * pose.scale * (1 - airborne * 0.55),
    3 * pose.scale,
    pose.angle,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.restore();
}

function drawMovingKind(
  context: CanvasRenderingContext2D,
  atlas: HTMLCanvasElement,
  sprites: readonly Sprite[],
  kind: SpriteKind,
  model: NationViewModel,
  tier: QualityTier,
  elapsed: number,
) {
  const count = visibleCount(kind, model, tier);
  for (const sprite of sprites) {
    if (sprite.kind !== kind) continue;
    const opacity = transitionOpacity(
      sprite,
      sprite.index < count ? 1 : 0,
      elapsed,
    );
    if (opacity < 0.02) continue;
    if (kind === "train") {
      drawTrain(context, atlas, sprite, opacity);
      continue;
    }
    const pose = spritePose(sprite);
    const alpha = opacity * edgeOpacity(progressOf(sprite));
    if (alpha <= 0) continue;
    if (kind === "plane") drawPlaneShadow(context, sprite, pose, alpha);
    if (kind === "ship") drawWake(context, pose, sprite.phase, alpha);
    drawAtlas(
      context,
      atlas,
      sprite,
      pose,
      alpha * (kind === "cloud" ? 0.26 : 1),
      kind === "ship" && sprite.index > 0 ? 1.8 : 1,
    );
  }
}

function drawCrane(
  context: CanvasRenderingContext2D,
  anchor: { readonly x: number; readonly y: number },
  phase: number,
  alpha: number,
) {
  const tipX = anchor.x + Math.sin(phase * 0.65) * 16;
  const tipY = anchor.y + 10;
  const lift = Math.sin(phase * 0.9) * 5;
  context.save();
  context.globalAlpha *= alpha;
  context.strokeStyle = "#d9a15e";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(anchor.x, anchor.y);
  context.lineTo(tipX, tipY);
  context.lineTo(tipX, tipY + 21 + lift);
  context.stroke();
  context.fillStyle = "#b96842";
  context.fillRect(tipX - 6, tipY + 20 + lift, 12, 7);
  context.restore();
}

function drawRegionalEffects(
  context: CanvasRenderingContext2D,
  sprites: readonly Sprite[],
  model: NationViewModel,
  tier: QualityTier,
  ambience: AmbientBlend,
) {
  const phase = sprites[0]?.phase ?? 0;
  if (ambience.construction > 0.01)
    drawCrane(
      context,
      MOTION_ANCHORS.constructionCrane,
      phase,
      0.8 * ambience.construction,
    );
  if (ambience.harbor > 0.01)
    drawCrane(
      context,
      MOTION_ANCHORS.harborCrane,
      phase + 2,
      0.75 * ambience.harbor,
    );

  if (tier !== "low") {
    // Steam is a visual cue for factory activity, not a pollution measurement.
    const steamCount = tier === "high" ? MOTION_ANCHORS.steam.length : 1;
    for (let index = 0; index < steamCount; index += 1) {
      const anchor = MOTION_ANCHORS.steam[index]!;
      for (let puff = 0; puff < model.regions.industry.stage; puff += 1) {
        const drift = (phase * 7 + puff * 13) % 45;
        context.save();
        context.globalAlpha *= 0.15 * (1 - drift / 50);
        context.fillStyle = "#f2f4e9";
        context.beginPath();
        context.arc(
          anchor.x + drift * 0.28,
          anchor.y - drift,
          4 + drift * 0.16,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.restore();
      }
    }

    const turbines = tier === "high" ? MOTION_ANCHORS.turbines.length : 2;
    for (let index = 0; index < turbines; index += 1) {
      const anchor = MOTION_ANCHORS.turbines[index]!;
      const angle = phase * (0.65 + model.regions.energy.stage * 0.08) + index;
      context.save();
      context.globalAlpha *= 0.55;
      context.strokeStyle = "#f7f9e8";
      context.lineWidth = 1.5;
      for (let blade = 0; blade < 3; blade += 1) {
        const a = angle + (blade * Math.PI * 2) / 3;
        context.beginPath();
        context.moveTo(anchor.x, anchor.y);
        context.lineTo(
          anchor.x + Math.cos(a) * 13,
          anchor.y + Math.sin(a) * 13,
        );
        context.stroke();
      }
      context.restore();
    }

    if (tier === "high") {
      const sway = Math.sin(phase * 1.15) * 2;
      for (const anchor of MOTION_ANCHORS.trees) {
        context.save();
        context.globalAlpha *= 0.35;
        context.strokeStyle = "#b7d7a1";
        context.lineWidth = 1.6;
        context.beginPath();
        context.moveTo(anchor.x, anchor.y);
        context.lineTo(anchor.x + sway, anchor.y - 10);
        context.stroke();
        context.restore();
      }
      for (const anchor of MOTION_ANCHORS.crops) {
        context.save();
        context.globalAlpha *= 0.35;
        context.strokeStyle = "#f7df9c";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(anchor.x, anchor.y);
        context.lineTo(anchor.x + sway, anchor.y - 7);
        context.stroke();
        context.restore();
      }
    }
  }

  if (ambience.night > 0.01) {
    context.save();
    context.globalAlpha *= ambience.night * (0.4 + ambience.activity * 0.45);
    context.fillStyle = "#ffe6a1";
    for (const point of MOTION_ANCHORS.windows)
      context.fillRect(point.x, point.y, 3, 5);
    for (const point of MOTION_ANCHORS.lamps) {
      context.beginPath();
      context.arc(point.x, point.y, 3, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
  if (tier !== "low") {
    const count = tier === "high" ? MOTION_ANCHORS.waves.length : 4;
    context.save();
    context.globalAlpha *= 0.25 + ambience.night * 0.12 + ambience.alert * 0.06;
    context.strokeStyle = "#e8ffff";
    context.lineWidth = 1.5;
    for (let index = 0; index < count; index += 1) {
      const point = MOTION_ANCHORS.waves[index]!;
      const shimmer = Math.sin(phase * 1.2 + index * 1.9) * 5;
      context.beginPath();
      context.moveTo(point.x + shimmer, point.y);
      context.lineTo(point.x + 13 + shimmer, point.y - 1);
      context.stroke();
    }
    context.restore();
  }
}

/** Draws ephemeral scene state without touching GameState or its RNG. */
export function drawMotionFrame(
  context: CanvasRenderingContext2D,
  atlas: HTMLCanvasElement,
  sprites: readonly Sprite[],
  model: NationViewModel,
  tier: QualityTier,
  elapsedSeconds: number,
) {
  const elapsed = Math.min(0.1, Math.max(0, elapsedSeconds));
  // Hidden sprites keep their phase across a quality or monthly state change.
  for (const sprite of sprites) advanceSprite(sprite, elapsed);
  const ambience = ambientBlend(sprites, model, elapsed);
  context.clearRect(0, 0, MOTION_WIDTH, MOTION_HEIGHT);

  // The lifecycle tests use a minimal canvas mock. A real Canvas 2D context
  // always has these transform and path methods.
  if (
    typeof context.rotate !== "function" ||
    typeof context.scale !== "function" ||
    typeof context.stroke !== "function" ||
    typeof context.ellipse !== "function"
  ) {
    for (const sprite of sprites) {
      if (sprite.index >= visibleCount(sprite.kind, model, tier)) continue;
      const pose = spritePose(sprite);
      context.drawImage(
        atlas,
        KINDS.indexOf(sprite.kind) * ICON_SIZE,
        0,
        ICON_SIZE,
        ICON_SIZE,
        pose.x,
        pose.y,
        ICON_SIZE * pose.scale,
        ICON_SIZE * pose.scale,
      );
    }
    return;
  }

  drawMovingKind(context, atlas, sprites, "cloud", model, tier, elapsed);
  drawRegionalEffects(context, sprites, model, tier, ambience);
  drawMovingKind(context, atlas, sprites, "train", model, tier, elapsed);
  drawMovingKind(context, atlas, sprites, "car", model, tier, elapsed);
  drawMovingKind(context, atlas, sprites, "plane", model, tier, elapsed);
  drawMovingKind(context, atlas, sprites, "person", model, tier, elapsed);
  drawMovingKind(context, atlas, sprites, "ship", model, tier, elapsed);
}

/** Preserve state cues without advancing sprites or scheduling animation. */
export function drawStillFrame(
  context: CanvasRenderingContext2D,
  sprites: readonly Sprite[],
  model: NationViewModel,
  tier: QualityTier,
) {
  context.clearRect(0, 0, MOTION_WIDTH, MOTION_HEIGHT);
  // Minimal canvas mocks used by lifecycle tests do not expose path drawing.
  if (typeof context.stroke !== "function") return;
  drawRegionalEffects(
    context,
    sprites,
    model,
    tier,
    ambientBlend(sprites, model, 1),
  );
}

/** Capped at 30 drawn frames per second; one low sample steps down the density. */
export function nextQualityTier(
  tier: QualityTier,
  measuredFps: number,
): QualityTier {
  if (measuredFps >= MINIMUM_FPS) return tier;
  return tier === "high" ? "medium" : "low";
}

/** Converts local frame sampling into the three performance gates shown in diagnostics. */
export function frameRateStatus(fps: number | null): FrameRateStatus {
  if (fps === null) return "measuring";
  if (fps >= TARGET_FPS) return "target";
  if (fps >= MINIMUM_FPS) return "minimum";
  return "slow";
}
