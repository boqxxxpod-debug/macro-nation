import { webcrypto } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { createGame } from "../application/game-service";
import { describeCause, eventDisplayName, label } from "./game-format";

let state: GameState;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  state = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "issue-90-causal-labels",
  );
});

it("distinguishes event damage from the protective effect of preparedness", () => {
  const original = structuredClone(state);
  expect(
    describeCause({ sourceType: "event", sourceId: "evt-demand-slump" }, state),
  ).toBe("需要の急な落ち込み");
  expect(
    describeCause(
      { sourceType: "event", sourceId: "evt-demand-slump:preparedness" },
      state,
    ),
  ).toBe("需要の急な落ち込みへの備え");
  expect(state).toEqual(original);
});

it("uses the saved event title and hides unknown implementation identifiers", () => {
  const saved = structuredClone(state);
  const content = saved.configSnapshot.normalizedConfig.content as {
    events: { eventId: string; title: string }[];
  };
  content.events[0]!.title = "保存したときの出来事名";
  expect(eventDisplayName("evt-demand-slump", saved)).toBe(
    "保存したときの出来事名",
  );
  expect(eventDisplayName("private-event-id", saved)).toBe(
    "経済に影響する出来事",
  );
  expect(label("private-model-path")).toBe("経済の指標");
  expect(label("economy.industries.manufacturing.productionIndex")).toBe(
    "製造業の生産指数",
  );
});
