import type { RngBundle, RngStreamState } from "@macro-nation/domain";

export const RNG_VERSION = "xoshiro128ss-v1" as const;
const UINT32_SCALE = 0x1_0000_0000;

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (const character of input) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function deriveState(rootSeed: string, streamId: string): [number, number, number, number] {
  const state: [number, number, number, number] = [0, 0, 0, 0];
  for (let index = 0; index < 4; index += 1) {
    state[index] = fnv1a(
      `${RNG_VERSION}\u0000${rootSeed}\u0000${streamId}\u0000${index}`,
    );
  }
  if (state.every((value) => value === 0)) state[0] = 0x9e3779b9;
  return state;
}

export interface RngStep {
  readonly value: number;
  readonly state: readonly [number, number, number, number];
}

export function xoshiro128ssStep(
  input: readonly [number, number, number, number],
): RngStep {
  let [s0, s1, s2, s3] = input.map((value) => value >>> 0) as [
    number,
    number,
    number,
    number,
  ];
  const value = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  s2 = (s2 ^ s0) >>> 0;
  s3 = (s3 ^ s1) >>> 0;
  s1 = (s1 ^ s2) >>> 0;
  s0 = (s0 ^ s3) >>> 0;
  s2 = (s2 ^ t) >>> 0;
  s3 = rotl(s3, 11);
  return { value, state: [s0, s1, s2, s3] };
}

export function createRngStream(rootSeed: string, streamId: string): RngStreamState {
  return { streamId, state: deriveState(rootSeed, streamId), drawCount: 0 };
}

export function createRngBundle(
  rootSeed: string,
  streamIds: readonly string[] = [],
): RngBundle {
  const streams = Object.fromEntries(
    [...new Set(streamIds)]
      .sort()
      .map((streamId) => [streamId, createRngStream(rootSeed, streamId)]),
  );
  return { rootSeed, rngVersion: RNG_VERSION, streams };
}

function getStream(bundle: RngBundle, streamId: string): RngStreamState {
  return bundle.streams[streamId] ?? createRngStream(bundle.rootSeed, streamId);
}

export interface RngDrawResult {
  readonly value: number;
  readonly bundle: RngBundle;
}

export function drawUint32(bundle: RngBundle, streamId: string): RngDrawResult {
  if (bundle.rngVersion !== RNG_VERSION) {
    throw new RangeError(`Unsupported RNG version: ${bundle.rngVersion}`);
  }
  const stream = getStream(bundle, streamId);
  const step = xoshiro128ssStep(stream.state);
  const nextStream: RngStreamState = {
    streamId,
    state: step.state,
    drawCount: stream.drawCount + 1,
  };
  return {
    value: step.value,
    bundle: {
      ...bundle,
      streams: { ...bundle.streams, [streamId]: nextStream },
    },
  };
}

export function drawFloat01(bundle: RngBundle, streamId: string): RngDrawResult {
  const draw = drawUint32(bundle, streamId);
  return { value: draw.value / UINT32_SCALE, bundle: draw.bundle };
}

export function serializeRngBundle(bundle: RngBundle): string {
  return JSON.stringify(bundle);
}

export function deserializeRngBundle(serialized: string): RngBundle {
  const parsed = JSON.parse(serialized) as Partial<RngBundle>;
  if (
    parsed.rngVersion !== RNG_VERSION ||
    typeof parsed.rootSeed !== "string" ||
    !parsed.streams
  ) {
    throw new RangeError("Invalid RNG bundle");
  }
  for (const [streamId, stream] of Object.entries(parsed.streams)) {
    if (
      stream.streamId !== streamId ||
      stream.state.length !== 4 ||
      stream.state.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 0xffffffff,
      ) ||
      !Number.isInteger(stream.drawCount) ||
      stream.drawCount < 0
    ) {
      throw new RangeError(`Invalid RNG stream: ${streamId}`);
    }
  }
  return parsed as RngBundle;
}

/** Preview is deterministic and never consumes the live RNG bundle. */
export function previewQuantile(
  mode: "optimistic" | "base" | "pessimistic",
): number {
  return mode === "optimistic" ? 0.84 : mode === "pessimistic" ? 0.16 : 0.5;
}
