import { useId } from "react";
import { createPortal } from "react-dom";
import termHelpCopy from "./term-help-copy.json";

export type HelpTermId = keyof typeof termHelpCopy;

/** Native popovers provide keyboard dismissal and keep help out of page sizing. */
export function TermHelp({
  termId,
  name,
}: {
  termId: HelpTermId;
  name: string;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  return (
    <>
      <button
        type="button"
        className="term-help-button"
        popoverTarget={id}
        aria-label={`${name}の説明`}
        aria-haspopup="dialog"
      >
        {name}
      </button>
      {createPortal(
        <div
          id={id}
          popover="auto"
          role="dialog"
          aria-labelledby={titleId}
          className="term-help-popover"
        >
          <h3 id={titleId}>{name}</h3>
          <p>{termHelpCopy[termId]}</p>
          <button type="button" popoverTarget={id} popoverTargetAction="hide">
            閉じる
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
