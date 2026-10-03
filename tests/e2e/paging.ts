import { expect, type Page } from "@playwright/test";

export async function waitForEnlargedText(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const root = document.documentElement;
          const shell = document.querySelector<HTMLElement>(".app-shell");
          if (shell?.classList.contains("enlarged-text")) return true;
          return {
            rootStyle: root.getAttribute("style"),
            computedFontSize: getComputedStyle(root).fontSize,
            shellClass: shell?.className,
            deckClasses: Array.from(
              document.querySelectorAll<HTMLElement>("[data-page-deck]"),
            ).map((deck) => deck.className),
            viewportScale: window.visualViewport?.scale,
          };
        }),
      {
        message: "The shell must reflect the enlarged text before interaction",
      },
    )
    .toBe(true);
}

export async function waitForPageLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve, reject) => {
      const started = performance.now();
      let previous: string | undefined;
      let stableFrames = 0;
      function frame() {
        const decks = Array.from(
          document.querySelectorAll<HTMLElement>("[data-page-deck]"),
        ).filter(
          (deck) =>
            !deck.closest("[hidden], [inert]") &&
            deck.getClientRects().length > 0,
        );
        if (!decks.length) {
          resolve();
          return;
        }
        const snapshot = JSON.stringify(
          decks.map((deck) => {
            const content = deck.querySelector<HTMLElement>(
              ":scope > [data-page-current]",
            );
            return {
              label: deck.getAttribute("aria-label"),
              class: deck.className,
              width: content?.clientWidth,
              height: content?.clientHeight,
              current: content?.getAttribute("data-page-current"),
              status: deck.querySelector(".page-controls [role='status']")
                ?.textContent,
              items: Array.from(
                deck.querySelectorAll<HTMLElement>(
                  ":scope > [data-page-current] > [data-page-item]",
                ),
              ).map((item) => [
                item.hidden,
                item.getBoundingClientRect().height,
              ]),
            };
          }),
        );
        stableFrames = snapshot === previous ? stableFrames + 1 : 0;
        previous = snapshot;
        if (stableFrames >= 3) resolve();
        else if (performance.now() - started > 5_000)
          reject(new Error(`Page layout did not settle: ${snapshot}`));
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  });
}
