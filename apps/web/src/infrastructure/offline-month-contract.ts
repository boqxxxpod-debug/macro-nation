import { validateState, type GameState } from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  policyStateHash,
} from "@macro-nation/simulation-engine";
import { z } from "zod";

const stateSchema = z.custom<GameState>((value) => {
  try {
    const state = value as GameState;
    return (
      !!state &&
      typeof state.gameId === "string" &&
      Number.isSafeInteger(state.slotId) &&
      Number.isSafeInteger(state.tickSequence) &&
      state.versions?.engineVersion === ENGINE_VERSION &&
      validateState(state).length === 0
    );
  } catch {
    return false;
  }
});

export const monthRequestSchema = z
  .object({
    type: z.literal("CALCULATE_MONTH"),
    requestId: z.string().min(1),
    engineVersion: z.literal(ENGINE_VERSION),
    expectedStateHash: z.string().min(1),
    expectedTick: z.number().int().nonnegative(),
    state: stateSchema,
  })
  .refine(
    (request) =>
      request.expectedStateHash === policyStateHash(request.state) &&
      request.expectedTick === request.state.tickSequence,
  );

export const monthResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("RESULT"),
    requestId: z.string().min(1),
    engineVersion: z.literal(ENGINE_VERSION),
    expectedStateHash: z.string().min(1),
    state: stateSchema,
  }),
  z.object({
    type: z.literal("ERROR"),
    requestId: z.string().min(1),
    engineVersion: z.literal(ENGINE_VERSION),
    message: z.string().min(1),
  }),
]);

export type MonthWorkerRequest = z.infer<typeof monthRequestSchema>;
export type MonthWorkerResponse = z.infer<typeof monthResponseSchema>;
