import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { createGame, type GameRepository } from "../application/game-service";
import { NationVoice } from "./NationVoice";

async function stateWithReaction(): Promise<GameState> {
  const repository: GameRepository = {
    async load() {
      return null;
    },
    async save() {},
    async create() {},
  };
  const initial = await createGame(repository, "nation-voice-ui");
  return {
    ...initial,
    history: {
      ...initial.history,
      reports: [
        {
          monthIndex: 1,
          values: {},
          topCauses: [],
          reactions: [
            {
              reactionId: "reaction:1:citizens",
              audience: "citizens",
              direction: -1,
              strength: 3,
              lagMonths: 1,
              month: 1,
              representativeTopicKey: "inflation",
              causeRefs: [
                {
                  sourceType: "external",
                  sourceId: "import-prices",
                  labelKey: "inflation",
                  confidence: "high",
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe("NationVoice", () => {
  it("announces the actor, direction and exact cause and links to its report", async () => {
    const onOpenCause = vi.fn();
    render(
      <NationVoice
        state={await stateWithReaction()}
        onOpenCause={onOpenCause}
      />,
    );

    expect(screen.getByRole("heading", { name: "国民の声" })).toBeVisible();
    expect(screen.getByText(/懸念・強さ 大きい/)).toBeVisible();
    expect(screen.getByText(/external:import-prices/)).toBeVisible();
    screen.getByRole("button", { name: "関連指標と因果を見る" }).click();
    expect(onOpenCause).toHaveBeenCalledOnce();
  });

  it("renders nothing rather than inventing a voice without reactions", async () => {
    const state = await stateWithReaction();
    const empty = {
      ...state,
      history: { ...state.history, reports: [] },
    };
    const { container } = render(<NationVoice state={empty} />);
    expect(container).toBeEmptyDOMElement();
  });
});
