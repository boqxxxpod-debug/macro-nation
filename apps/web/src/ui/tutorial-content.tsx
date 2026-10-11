import type { GameState } from "@macro-nation/domain";
import { isTutorialTime } from "../application/game-clock";
import copy from "./first-play-copy.json";

/** Reuses the existing four-quarter instructions without changing progression. */
export function tutorialContent(state: GameState) {
  if (!isTutorialTime(state)) return null;
  const quarter = Math.floor(
    state.monthIndex / state.clock.config.policyCycleSteps,
  );
  return (
    <section className="panel tutorial" aria-label="4四半期チュートリアル">
      <h3>
        {copy.tutorialTitle}・第{quarter + 1}回
      </h3>
      <p>{copy.tutorialSteps[quarter]}</p>
      <p>{copy.tutorialNote}</p>
    </section>
  );
}
