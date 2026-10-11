/** Shared terrain, structures and motion coordinates on nation-terrain.webp. */
export const SCENE_WIDTH = 941;
export const SCENE_HEIGHT = 1672;

export interface PathPoint {
  readonly x: number;
  readonly y: number;
  /** Relative size follows the perspective already painted into the artwork. */
  readonly scale: number;
}

export interface PathPose extends PathPoint {
  readonly angle: number;
}

export const MOTION_PATHS = {
  roadCity: [
    { x: 400, y: 880, scale: 0.8 },
    { x: 470, y: 854, scale: 0.78 },
    { x: 560, y: 830, scale: 0.74 },
    { x: 650, y: 810, scale: 0.7 },
    { x: 740, y: 778, scale: 0.66 },
    { x: 840, y: 750, scale: 0.59 },
    { x: 940, y: 735, scale: 0.54 },
  ],
  roadPort: [
    { x: 18, y: 954, scale: 0.68 },
    { x: 117, y: 960, scale: 0.75 },
    { x: 223, y: 983, scale: 0.79 },
    { x: 337, y: 1020, scale: 0.85 },
    { x: 443, y: 1055, scale: 0.88 },
    { x: 539, y: 1093, scale: 0.86 },
  ],
  rail: [
    { x: 100, y: 580, scale: 0.43 },
    { x: 180, y: 630, scale: 0.5 },
    { x: 260, y: 677, scale: 0.57 },
    { x: 370, y: 745, scale: 0.65 },
    { x: 480, y: 815, scale: 0.72 },
    { x: 590, y: 860, scale: 0.77 },
    { x: 680, y: 887, scale: 0.75 },
  ],
  harborIn: [
    { x: 25, y: 1265, scale: 0.82 },
    { x: 110, y: 1250, scale: 0.88 },
    { x: 190, y: 1230, scale: 0.96 },
    { x: 270, y: 1212, scale: 1 },
    { x: 325, y: 1195, scale: 1 },
  ],
  harborOut: [
    { x: 325, y: 1195, scale: 1 },
    { x: 395, y: 1220, scale: 0.94 },
    { x: 465, y: 1250, scale: 0.87 },
    { x: 555, y: 1280, scale: 0.75 },
    { x: 665, y: 1310, scale: 0.63 },
  ],
  bayShip: [
    { x: 801, y: 370, scale: 0.31 },
    { x: 844, y: 393, scale: 0.33 },
    { x: 892, y: 425, scale: 0.36 },
    { x: 934, y: 462, scale: 0.38 },
  ],
  runway: [
    { x: 675, y: 1080, scale: 0.85 },
    { x: 733, y: 1054, scale: 0.86 },
    { x: 796, y: 1021, scale: 0.88 },
    { x: 858, y: 986, scale: 0.84 },
    { x: 919, y: 951, scale: 0.8 },
  ],
  flight: [
    { x: 919, y: 951, scale: 0.8 },
    { x: 943, y: 909, scale: 0.7 },
    { x: 959, y: 852, scale: 0.58 },
    { x: 974, y: 790, scale: 0.45 },
  ],
  walkCity: [
    { x: 337, y: 881, scale: 0.38 },
    { x: 396, y: 899, scale: 0.43 },
    { x: 462, y: 920, scale: 0.47 },
    { x: 523, y: 938, scale: 0.51 },
    { x: 585, y: 955, scale: 0.54 },
  ],
  walkQuay: [
    { x: 280, y: 1106, scale: 0.47 },
    { x: 334, y: 1120, scale: 0.51 },
    { x: 389, y: 1136, scale: 0.56 },
    { x: 464, y: 1151, scale: 0.58 },
  ],
  cloud: [
    { x: -70, y: 122, scale: 1.2 },
    { x: 200, y: 133, scale: 1.05 },
    { x: 457, y: 116, scale: 0.9 },
    { x: 720, y: 109, scale: 0.8 },
    { x: 1010, y: 100, scale: 0.75 },
  ],
} as const satisfies Record<string, readonly PathPoint[]>;

export type MotionPathId = keyof typeof MOTION_PATHS;

/** Fixed scenery is already painted here; these are small motion overlays. */
export const MOTION_ANCHORS = {
  constructionCrane: { x: 576, y: 498 },
  harborCrane: { x: 270, y: 985 },
  steam: [
    { x: 28, y: 679 },
    { x: 66, y: 667 },
  ],
  turbines: [
    { x: 482, y: 307 },
    { x: 516, y: 270 },
    { x: 590, y: 275 },
    { x: 650, y: 302 },
  ],
  trees: [
    { x: 154, y: 421 },
    { x: 248, y: 436 },
    { x: 758, y: 421 },
  ],
  crops: [
    { x: 89, y: 476 },
    { x: 178, y: 486 },
  ],
  windows: [
    { x: 430, y: 629 },
    { x: 481, y: 650 },
    { x: 515, y: 699 },
    { x: 627, y: 705 },
    { x: 695, y: 733 },
  ],
  lamps: [
    { x: 358, y: 897 },
    { x: 547, y: 969 },
    { x: 735, y: 913 },
  ],
  waves: [
    { x: 90, y: 1277 },
    { x: 387, y: 1258 },
    { x: 683, y: 1238 },
    { x: 506, y: 1427 },
    { x: 802, y: 1374 },
    { x: 224, y: 1512 },
    { x: 713, y: 1573 },
  ],
} as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const PATH_METRICS = Object.fromEntries(
  Object.entries(MOTION_PATHS).map(([id, points]) => {
    const lengths = points
      .slice(1)
      .map((point, index) =>
        Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
      );
    return [
      id,
      { lengths, total: lengths.reduce((sum, length) => sum + length, 0) },
    ];
  }),
) as unknown as Record<
  MotionPathId,
  { readonly lengths: readonly number[]; readonly total: number }
>;

/** Distance-weighted Catmull-Rom interpolation gives a steady apparent pace. */
export function sampleMotionPath(id: MotionPathId, progress: number): PathPose {
  const points = MOTION_PATHS[id];
  if (progress >= 1) {
    const previous = points[points.length - 2]!;
    const last = points[points.length - 1]!;
    return {
      ...last,
      angle: Math.atan2(last.y - previous.y, last.x - previous.x),
    };
  }
  const { lengths, total } = PATH_METRICS[id];
  let remaining = clamp01(progress) * total;
  let segment = lengths.length - 1;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index]!) {
      segment = index;
      break;
    }
    remaining -= lengths[index]!;
  }
  const t = lengths[segment]! > 0 ? remaining / lengths[segment]! : 0;
  const p0 = points[Math.max(0, segment - 1)]!;
  const p1 = points[segment]!;
  const p2 = points[segment + 1]!;
  const p3 = points[Math.min(points.length - 1, segment + 2)]!;
  const cubic = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t * t +
      (-a + 3 * b - 3 * c + d) * t * t * t);
  const derivative = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (-a +
      c +
      2 * (2 * a - 5 * b + 4 * c - d) * t +
      3 * (-a + 3 * b - 3 * c + d) * t * t);
  return {
    x: cubic(p0.x, p1.x, p2.x, p3.x),
    y: cubic(p0.y, p1.y, p2.y, p3.y),
    scale: cubic(p0.scale, p1.scale, p2.scale, p3.scale),
    angle: Math.atan2(
      derivative(p0.y, p1.y, p2.y, p3.y),
      derivative(p0.x, p1.x, p2.x, p3.x),
    ),
  };
}
