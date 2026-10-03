import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForEnlargedText, waitForPageLayout } from "./paging";
import type { GameState } from "@macro-nation/domain";

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 1366, height: 768 },
] as const;
const MAX_PAGE_STEPS = 2_000;

// Check actual geometry, including clipped content, rather than accepting a
// hidden scrollbar as evidence that a screen fits.
async function expectViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const problems: string[] = [];
        const root = document.documentElement;
        if (root.scrollWidth > innerWidth + 1) problems.push("document width");
        if (root.scrollHeight > innerHeight + 1)
          problems.push("document height");
        const visible = (element: HTMLElement) =>
          !element.closest("[hidden], [inert]") &&
          (!document.querySelector('[aria-modal="true"]') ||
            !!element.closest('[aria-modal="true"]')) &&
          getComputedStyle(element).visibility !== "hidden" &&
          element.getClientRects().length > 0;
        for (const element of document.querySelectorAll<HTMLElement>(
          "[data-page-current], [data-page-item], .panel, .game-view",
        )) {
          if (!visible(element)) continue;
          const bounds = element.getBoundingClientRect();
          const name = element.getAttribute("aria-label") ?? element.className;
          if (element.scrollWidth > element.clientWidth + 2)
            problems.push(`${name}: content width`);
          if (element.scrollHeight > element.clientHeight + 2)
            problems.push(
              JSON.stringify({
                name,
                issue: "content height",
                scroll: element.scrollHeight,
                client: element.clientHeight,
                html: element.outerHTML.slice(0, 350),
                bounds: {
                  top: bounds.top,
                  bottom: bounds.bottom,
                  height: bounds.height,
                },
                items: Array.from(
                  element.querySelectorAll<HTMLElement>(
                    ":scope > [data-page-item]",
                  ),
                )
                  .filter(visible)
                  .slice(0, 3)
                  .map((item) => ({
                    height: item.getBoundingClientRect().height,
                    top: item.getBoundingClientRect().top,
                    bottom: item.getBoundingClientRect().bottom,
                    html: item.innerHTML.slice(0, 350),
                  })),
                hiddenOversized: Array.from(
                  element.querySelectorAll<HTMLElement>(
                    ":scope > [data-page-item][hidden]",
                  ),
                )
                  .filter(
                    (item) =>
                      item.getBoundingClientRect().height >
                      element.clientHeight,
                  )
                  .slice(0, 2)
                  .map((item) => ({
                    height: item.getBoundingClientRect().height,
                    html: item.innerHTML.slice(0, 350),
                  })),
              }),
            );
          if (bounds.left < -1 || bounds.right > innerWidth + 1)
            problems.push(`${name}: outside width`);
          if (bounds.top < -1 || bounds.bottom > innerHeight + 1)
            problems.push(`${name}: outside height`);
        }
        for (const button of document.querySelectorAll<HTMLButtonElement>(
          "button",
        )) {
          if (!visible(button)) continue;
          const bounds = button.getBoundingClientRect();
          const name = button.getAttribute("aria-label") ?? button.textContent;
          if (bounds.width < 43.5 || bounds.height < 43.5)
            problems.push(`${name}: tap target`);
          if (
            bounds.top < -1 ||
            bounds.bottom > innerHeight + 1 ||
            bounds.left < -1 ||
            bounds.right > innerWidth + 1
          )
            problems.push(`${name}: outside viewport`);
          if (!button.disabled) {
            const hit = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            );
            if (hit !== button && !button.contains(hit))
              problems.push(
                JSON.stringify({
                  name,
                  issue: "covered",
                  bounds: {
                    left: bounds.left,
                    top: bounds.top,
                    width: bounds.width,
                    height: bounds.height,
                  },
                  covering: hit?.outerHTML.slice(0, 200),
                }),
              );
          }
        }
        for (const input of document.querySelectorAll<HTMLElement>(
          'select, textarea, input:not([type="radio"]):not([type="checkbox"])',
        )) {
          if (!visible(input)) continue;
          const bounds = input.getBoundingClientRect();
          const name =
            input.getAttribute("aria-label") ??
            input.closest("label")?.textContent;
          if (bounds.width < 43.5 || bounds.height < 43.5)
            problems.push(`${name}: input tap target`);
          if (bounds.top < -1 || bounds.bottom > innerHeight + 1)
            problems.push(`${name}: input outside viewport`);
          const hit = document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
          );
          if (hit !== input && !input.contains(hit))
            problems.push(`${name}: input covered`);
        }
        for (const input of document.querySelectorAll<HTMLInputElement>(
          'input[type="radio"], input[type="checkbox"]',
        )) {
          if (!visible(input)) continue;
          const target = input.closest("label") ?? input;
          const bounds = target.getBoundingClientRect();
          if (bounds.width < 43.5 || bounds.height < 43.5)
            problems.push(`${target.textContent}: choice tap target`);
        }
        return problems;
      }),
    )
    .toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const problems = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= innerWidth + 1) return [];
    const outside = Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    ).filter((element) => {
      if (
        element.closest("[hidden], [inert]") ||
        getComputedStyle(element).visibility === "hidden"
      )
        return false;
      const bounds = element.getBoundingClientRect();
      return (
        element.clientWidth > 0 &&
        (bounds.left < -1 ||
          bounds.right > innerWidth + 1 ||
          element.scrollWidth > element.clientWidth + 2)
      );
    });
    return [
      { viewport: innerWidth, document: document.documentElement.scrollWidth },
      ...outside.slice(0, 12).map((element) => ({
        tag: element.tagName,
        class: element.className,
        scroll: element.scrollWidth,
        client: element.clientWidth,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        html: element.outerHTML.slice(0, 300),
      })),
    ];
  });
  expect(
    problems,
    "enlarged text must not require horizontal scrolling",
  ).toEqual([]);
}

async function inspectDeck(page: Page, deck: Locator) {
  await waitForPageLayout(page);
  const previous = deck.getByRole("button", { name: /：前のページ$/ });
  const next = deck.getByRole("button", { name: /：次のページ$/ });
  for (
    let count = 0;
    count < MAX_PAGE_STEPS && (await previous.isEnabled());
    count++
  ) {
    await previous.click();
    await waitForPageLayout(page);
  }
  const reached = new Set<number>();
  for (let count = 0; count < MAX_PAGE_STEPS; count++) {
    await expectViewport(page);
    const shown = await deck.evaluate((element) =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          ":scope > [data-page-current] > [data-page-item]",
        ),
      ).flatMap((item, index) => (item.hidden ? [] : [index])),
    );
    for (const index of shown) reached.add(index);
    if (!(await next.isEnabled())) break;
    const current = deck.locator(":scope > [data-page-current]");
    const pageBefore = await current.getAttribute("data-page-current");
    await next.click();
    await waitForPageLayout(page);
    await expect(current).not.toHaveAttribute("data-page-current", pageBefore!);
    await expect(current).toBeFocused();
  }
  const count = await deck
    .locator(":scope > [data-page-current] > [data-page-item]")
    .count();
  expect(reached.size, "every content fragment must be reachable").toBe(count);
}

async function inspectPages(page: Page) {
  const decks = (await page.locator('[aria-modal="true"]').count())
    ? page.locator('[aria-modal="true"] [data-page-deck]:visible')
    : page.locator("[data-page-deck]:visible");
  for (let index = 0; index < (await decks.count()); index++)
    await inspectDeck(page, decks.nth(index));
  await expectViewport(page);
}

async function reach(page: Page, control: Locator) {
  await waitForPageLayout(page);
  if (await control.isVisible()) return;
  const previous = page.getByRole("button", { name: /：前のページ$/ });
  for (
    let count = 0;
    count < MAX_PAGE_STEPS && (await previous.isEnabled());
    count++
  ) {
    await previous.click();
    await waitForPageLayout(page);
    if (await control.isVisible()) return;
  }
  const next = page.getByRole("button", { name: /：次のページ$/ });
  for (let count = 0; count < MAX_PAGE_STEPS; count++) {
    if (await control.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  await expect(control).toBeVisible();
}

async function startGame(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "ゲームを始める" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
}

async function inspectHome(page: Page) {
  const choices = page.getByRole("combobox", { name: "ホームの詳細" });
  const labels = await choices.locator("option").allTextContents();
  for (const label of labels) {
    await choices.selectOption({ label });
    await inspectPages(page);
  }
  await choices.selectOption({ label: "今月の報告" });
  for (const name of ["1か月進める", "政策を考える", "理由を見る"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

async function previewPolicy(page: Page) {
  await page.getByRole("button", { name: "政策会議", exact: true }).click();
  const value = page.getByRole("spinbutton", { name: "政策金利の設定値" });
  await reach(page, value);
  await value.fill("0.05");
  await inspectPages(page);
  await reach(page, value);
  await expect(value).toHaveValue("0.05");
  await page.getByRole("button", { name: "1年・5年を比較する" }).click();
  await expect(
    page.getByRole("heading", { name: "政策プレビュー" }),
  ).toBeFocused();
}

async function confirmPolicy(page: Page) {
  const confirm = page.getByRole("button", { name: "政策を確定して保存" });
  await expect(confirm).toBeDisabled();
  const reviewed = page.getByRole("checkbox", {
    name: "費用・副作用・警告を確認しました",
  });
  await reach(page, reviewed);
  await reviewed.check();
  await expect(confirm).toBeEnabled();
  await confirm.dblclick();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
  await expectNotice(page, "政策を確定し、端末に保存しました。");
}

async function expectNotice(page: Page, message: string | RegExp) {
  await page.getByRole("button", { name: "通知の詳細", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "通知の詳細" });
  await expect(
    dialog.getByText(message, { exact: typeof message === "string" }),
  ).toBeVisible();
  await inspectPages(page);
  await dialog.getByRole("button", { name: "詳細を閉じる" }).click();
}

async function savedState(page: Page): Promise<GameState> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("macro-nation-games", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<GameState>((resolve, reject) => {
        const request = database
          .transaction("slots")
          .objectStore("slots")
          .get(1);
        request.onsuccess = () => resolve(request.result.current as GameState);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

// These fixtures exercise presentation of durable states without modifying
// production simulation rules or waiting for random crises to occur.
async function seedPresentation(
  page: Page,
  runState: GameState["runState"],
  longHistory = false,
) {
  await page.evaluate(
    async ({ runState, longHistory }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("macro-nation-games", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("slots", "readwrite");
          const store = transaction.objectStore("slots");
          const request = store.get(1);
          request.onsuccess = () => {
            const record = request.result;
            const state = record.current as GameState;
            const historyMonth = runState === "completed" ? 360 : 120;
            const dateOffset =
              state.clock.month - 1 + historyMonth - state.monthIndex;
            const eventId = "長い日本語のイベントと対策を確認する".repeat(18);
            const occurrences = Array.from(
              { length: longHistory ? 120 : 1 },
              (_, month) => ({
                eventId: longHistory ? `viewport-history-${month}` : eventId,
                occurredMonth: month,
                preparedness: 0.5,
                baselineDamage: -1,
                preparednessMitigation: 0,
                choiceMitigation: 0,
                targetPath: "economy.indices.realGdp",
              }),
            );
            const next: GameState = {
              ...state,
              runState,
              ...(longHistory
                ? {
                    durationMode: "ultraLong",
                    monthIndex: historyMonth,
                    tickSequence: historyMonth,
                    clock: {
                      ...state.clock,
                      durationMode: "ultraLong",
                      endMonth: 360,
                      year: state.clock.year + Math.floor(dateOffset / 12),
                      month: (dateOffset % 12) + 1,
                    },
                  }
                : runState === "completed"
                  ? { monthIndex: state.clock.endMonth ?? 48 }
                  : {}),
              events: {
                ...state.events,
                ...(runState === "awaitingEvent"
                  ? { pendingChoiceEventId: eventId }
                  : {}),
                occurrences,
                warnings: Array.from({ length: 12 }, (_, index) => ({
                  eventId: `${eventId}${index}`,
                  severity: 3 as const,
                  preparedness: 0.1,
                  missingIndicatorIds: ["realGdp", "policyTrust"],
                })),
              },
              ...(longHistory
                ? {
                    history: {
                      ...state.history,
                      reports: state.history.reports?.at(-1)
                        ? Array.from(
                            { length: historyMonth + 1 },
                            (_, monthIndex) => ({
                              ...state.history.reports!.at(-1)!,
                              monthIndex,
                            }),
                          )
                        : state.history.reports,
                      learningEntries: Array.from(
                        { length: 24 },
                        (_, month) => ({
                          entryId: `viewport-note-${month}`,
                          month,
                          kind: "verification" as const,
                          concept: `履歴ノート${month}`,
                          evidence:
                            "日本語の長い説明も途中で省略せず、理由をすべて確認できます。".repeat(
                              4,
                            ),
                          mode: "learning" as const,
                        }),
                      ),
                      forecastRecords: Array.from(
                        { length: 12 },
                        (_, month) => ({
                          recordId: `viewport-forecast-${month}`,
                          decisionId: `viewport-decision-${month}`,
                          recordedMonth: month,
                          expertIds: ["macro"],
                          confidence: "medium" as const,
                          uncertainty:
                            "ゲーム内の試算には外部環境の不確実性があります。",
                          horizons: [
                            { months: 12 as const, indicators: { realGdp: 1 } },
                            { months: 60 as const, indicators: { realGdp: 2 } },
                          ],
                        }),
                      ),
                      reviews: [60, 120, 180, 240, 300, 360]
                        .filter((month) => month <= historyMonth)
                        .map((monthIndex) => ({
                          monthIndex,
                          axes: {
                            living: 50,
                            growth: 50,
                            stability: 50,
                            sustainability: 50,
                            trust: 50,
                          },
                          policyIds: [],
                          crisisMonths: 0,
                          causeRefs: [],
                        })),
                    },
                  }
                : {}),
            };
            store.put({ ...record, current: next });
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    },
    { runState, longHistory },
  );
  await page.reload();
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}×${viewport.height}: every screen and detail page fits`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "ゲームを始める" }),
    ).toBeVisible();
    await inspectPages(page);
    await page.getByRole("button", { name: "ゲームを始める" }).click();
    await expect(
      page.getByRole("heading", { name: "国家ホーム" }),
    ).toBeFocused();
    await inspectHome(page);
    if (viewport.width === 360)
      await testInfo.attach("home-360-after", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    await page.getByRole("button", { name: "1か月進める" }).click();
    await expectNotice(page, /まで進み、保存しました。/);
    await inspectHome(page);
    await page.getByRole("button", { name: "国家ビュー", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "国家ビュー" }),
    ).toBeFocused();
    await inspectPages(page);
    if (viewport.width === 360)
      await testInfo.attach("nation-360-after", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    const harbor = page.getByRole("button", { name: /^港湾を選択/ });
    await harbor.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const details = page.getByRole("combobox", { name: "詳細の表示" });
    for (const label of await details.locator("option").allTextContents()) {
      // selectOption changes values without focusing the native control.
      // Preserve the focus a player has while switching detail screens.
      await details.focus();
      await details.selectOption({ label });
      await inspectPages(page);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(harbor).toBeFocused();
    await previewPolicy(page);
    if (viewport.width === 360)
      await testInfo.attach("preview-360-after", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    await inspectPages(page);
    await confirmPolicy(page);
    expect(
      (await savedState(page)).policyAdministration?.receipts,
    ).toHaveLength(1);
    await page.getByRole("button", { name: "レポート", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "経済レポート" }),
    ).toBeFocused();
    await inspectPages(page);
    await seedPresentation(page, "completed", true);
    await page.goto("/game/1/ending");
    await expect(page.getByRole("heading", { name: "終了評価" })).toBeFocused();
    await inspectPages(page);
    await reach(page, page.getByText("119月目：イベント", { exact: true }));
    await page.getByRole("button", { name: "レポートで理由を見る" }).click();
    await expect(
      page.getByRole("heading", { name: "経済レポート" }),
    ).toBeFocused();
    await inspectPages(page);
    await reach(
      page,
      page.getByRole("heading", { name: "履歴ノート0", exact: true }).first(),
    );
    await expect(
      page.getByRole("heading", { name: "履歴ノート0", exact: true }).first(),
    ).toBeVisible();
  });
}

test("long Japanese, warnings, crisis and event choices remain reachable at 360×640", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await startGame(page);
  await seedPresentation(page, "crisisStopped", true);
  await expect(
    page.getByRole("button", { name: "1か月進める" }),
  ).toBeDisabled();
  await inspectHome(page);
  await page
    .getByRole("combobox", { name: "ホームの詳細" })
    .selectOption({ label: "危機・イベント対応" });
  await reach(
    page,
    page.getByRole("button", { name: "危機対応を確認して再開" }),
  );
  await page.getByRole("button", { name: "危機対応を確認して再開" }).click();
  await expectNotice(page, "危機対応を保存し、再開できる状態になりました。");
  expect((await savedState(page)).runState).toBe("paused");
  await seedPresentation(page, "awaitingEvent");
  await inspectPages(page);
  await reach(page, page.getByRole("button", { name: "均衡対応" }));
  await page.getByRole("button", { name: "均衡対応" }).click();
  await expectNotice(page, "イベント対応を保存しました。");
  const saved = await savedState(page);
  expect(saved.runState).toBe("paused");
  expect(saved.events.occurrences?.at(-1)?.choiceId).toBe("balanced");
  await seedPresentation(page, "failed", true);
  await page.goto("/game/1/ending");
  await reach(page, page.getByRole("heading", { name: /総合評価：F/ }).first());
  await inspectPages(page);
});

test("200% text and keyboard retain policy confirmation and explicit crisis resume", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const pager = page.getByRole("button", {
    name: "起動・開始設定：次のページ",
  });
  await expect(pager).toBeEnabled();
  const content = page.locator("[data-page-current]");
  const before = await content.getAttribute("data-page-current");
  await pager.focus();
  await page.keyboard.press("Enter");
  await expect(content).not.toHaveAttribute("data-page-current", before!);
  await expect(content).toBeFocused();
  for (let count = 0; count < 8; count++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("[hidden], [inert]"),
      ),
    ).toBe(false);
  }
  await page.getByRole("button", { name: "ゲームを始める" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await waitForEnlargedText(page);
  await waitForPageLayout(page);
  await page.getByRole("button", { name: "政策会議", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "政策会議" })).toBeFocused();
  await page.getByRole("spinbutton", { name: "政策金利の設定値" }).fill("0.05");
  await page.getByRole("button", { name: "1年・5年を比較する" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "政策プレビュー" }),
  ).toBeFocused();
  await page
    .getByRole("checkbox", { name: "費用・副作用・警告を確認しました" })
    .focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "政策を確定して保存" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
  await expectNoHorizontalScroll(page);
  await seedPresentation(page, "crisisStopped");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await waitForEnlargedText(page);
  await waitForPageLayout(page);
  await page.getByRole("button", { name: "危機対応を確認して再開" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "通知の詳細", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("危機対応を保存し、再開できる状態になりました。"),
  ).toBeVisible();
  expect((await savedState(page)).runState).toBe("paused");
  await expectNoHorizontalScroll(page);
});

test("busy and long error details fit and return focus without discarding a draft", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 640 });
  const message =
    "政策の試算を完了できませんでした。入力した案は保持されています。".repeat(
      30,
    );
  await page.addInitScript((message) => {
    class PendingPreviewWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      release: (() => void) | null = null;
      postMessage(input: { requestId: string }) {
        this.release = () =>
          this.onmessage?.(
            new MessageEvent("message", {
              data: { type: "ERROR", requestId: input.requestId, message },
            }),
          );
        window.addEventListener("release-fixture-preview", this.release, {
          once: true,
        });
      }
      terminate() {
        if (this.release)
          window.removeEventListener("release-fixture-preview", this.release);
      }
    }
    Object.defineProperty(window, "Worker", { value: PendingPreviewWorker });
  }, message);
  await startGame(page);
  await page.getByRole("button", { name: "政策会議", exact: true }).click();
  const input = page.getByRole("spinbutton", { name: "政策金利の設定値" });
  await reach(page, input);
  await input.fill("0.05");
  const compare = page.getByRole("button", { name: "1年・5年を比較する" });
  await compare.click();
  await expect(compare).toBeDisabled();
  await expect(page.getByText("計算・保存中…")).toBeAttached();
  await expectViewport(page);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("release-fixture-preview")),
  );
  const errorDetails = page.getByRole("button", { name: "エラーの詳細" });
  await expect(errorDetails).toBeVisible();
  await errorDetails.click();
  const dialog = page.getByRole("dialog", { name: "通知の詳細" });
  await expect(dialog).toContainText(message);
  await inspectPages(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(errorDetails).toBeFocused();
  await reach(page, input);
  await expect(input).toHaveValue("0.05");
  expect(
    (await savedState(page)).policyAdministration?.receipts ?? [],
  ).toHaveLength(0);
});
