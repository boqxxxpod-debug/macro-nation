import type { GameState } from "@macro-nation/domain";
import { isTutorialTime } from "../application/game-clock";
import copy from "./first-play-copy.json";

export function FirstPlayGuide({
  id,
  state,
  onPolicies,
  onClose,
  onHelp,
}: {
  id: string;
  state: GameState;
  onPolicies(): void;
  onClose(): void;
  onHelp(): void;
}) {
  return (
    <section id={id} className="panel first-play-guide" aria-label={copy.title}>
      <header>
        <h3 tabIndex={-1}>{copy.title}</h3>
        <button onClick={onClose}>{copy.close}</button>
      </header>
      <button className="primary" onClick={onPolicies}>
        {copy.policies}
      </button>
      <p>
        {state.clock.progressionMode !== "auto"
          ? copy.continue
          : isTutorialTime(state)
            ? copy.continueTutorial
            : copy.continueAuto}
      </p>
      <p>{copy.next}</p>
      <button onClick={onHelp}>{copy.help}</button>
    </section>
  );
}
