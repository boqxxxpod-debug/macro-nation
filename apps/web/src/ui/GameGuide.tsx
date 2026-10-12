import gameGuideCopy from "./game-guide-copy.json";

/** Plain elements keep every paragraph available through PageDeck pagination. */
export function gameGoalContent() {
  return (
    <section className="panel" aria-label={gameGuideCopy.goals.title}>
      <h3>{gameGuideCopy.goals.title}</h3>
      <p>{gameGuideCopy.goals.balance}</p>
      <p>{gameGuideCopy.goals.choice}</p>
    </section>
  );
}

export function gameGuideContent() {
  return (
    <>
      {gameGoalContent()}
      {gameGuideCopy.steps.map((step) => (
        <section className="panel" key={step.title} aria-label={step.title}>
          <h3>{step.title}</h3>
          {step.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
      <section className="panel" aria-label={gameGuideCopy.settings.title}>
        <h3>{gameGuideCopy.settings.title}</h3>
        {gameGuideCopy.settings.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>
    </>
  );
}
