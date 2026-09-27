import { beforeAll, describe, expect, it } from "vitest";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
} from "@macro-nation/model-config";
import type { GameState, VersionTuple } from "@macro-nation/domain";
import {
  createSCN01InitialState,
  ENGINE_VERSION,
  runPolicyHeadless,
} from "./index";

let initial: GameState;

beforeAll(async () => {
  const configSnapshot = await createConfigSnapshot(
    await loadSCN01ConfigPack(),
  );
  const versions: VersionTuple = {
    saveSchemaVersion: "1",
    engineVersion: ENGINE_VERSION,
    configSchemaVersion: "1",
    modelVersion: "0.1.2",
    calibrationVersion: "advanced-small-open-v1.0.0",
    contentVersion: "1.1.0",
    rngVersion: "xoshiro128ss-v1",
    configVersion: configSnapshot.snapshotVersion,
  };
  initial = createSCN01InitialState({
    configSnapshot,
    seed: "issue-26",
    versions,
  });
});

function certainEventState(): GameState {
  const normalized = structuredClone(
    initial.configSnapshot.normalizedConfig,
  ) as Record<string, unknown>;
  const content = normalized.content as {
    events: {
      eventId: string;
      baseMonthlyProbability: number;
      condition: unknown[];
    }[];
  };
  content.events = content.events.map((event) =>
    event.eventId === "evt-demand-slump"
      ? { ...event, baseMonthlyProbability: 1, condition: [] }
      : { ...event, baseMonthlyProbability: 0 },
  );
  return {
    ...initial,
    configSnapshot: { ...initial.configSnapshot, normalizedConfig: normalized },
  };
}

describe("event warnings and preparedness", () => {
  it("draws reproducibly and separates baseline damage from preparedness mitigation", () => {
    const left = runPolicyHeadless({
      initialState: certainEventState(),
      tickCount: 1,
    });
    const right = runPolicyHeadless({
      initialState: certainEventState(),
      tickCount: 1,
    });
    expect(left.finalState.events).toEqual(right.finalState.events);
    expect(left.finalState.runState).toBe("awaitingEvent");
    const terms = left.records[0]!.diagnostics.causal.find((item) =>
      item.contributions.some((term) => term.sourceId === "evt-demand-slump"),
    )!.contributions;
    expect(terms.map((term) => term.sourceId)).toEqual([
      "evt-demand-slump",
      "evt-demand-slump:preparedness",
    ]);
    expect(terms[0]!.delta).toBeLessThan(0);
    expect(terms[1]!.delta).toBeGreaterThan(0);
  });

  it("exposes preparedness shortfalls in a warning before occurrence", () => {
    const state = certainEventState();
    const normalized = structuredClone(
      state.configSnapshot.normalizedConfig,
    ) as Record<string, unknown>;
    const content = normalized.content as {
      events: {
        eventId: string;
        baseMonthlyProbability: number;
        condition: unknown[];
        leadingIndicators: unknown[];
      }[];
    };
    content.events = content.events.map((event) =>
      event.eventId === "evt-demand-slump"
        ? { ...event, baseMonthlyProbability: 0, leadingIndicators: [] }
        : event,
    );
    const result = runPolicyHeadless({
      initialState: {
        ...state,
        configSnapshot: {
          ...state.configSnapshot,
          normalizedConfig: normalized,
        },
      },
      tickCount: 1,
    });
    expect(result.finalState.events.warnings).toEqual([]);
  });
});
