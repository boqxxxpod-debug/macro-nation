import { expect, test, type Locator, type Page } from "@playwright/test";
import type { GameState } from "@macro-nation/domain";
import { waitForPageLayout } from "./paging";

test.use({ viewport: { width: 360, height: 640 } });
test.setTimeout(120_000);

async function activateWithKeyboard(page: Page, target: Locator) {
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.press("Enter");
}

async function savedState(page: Page): Promise<GameState> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("macro-nation-games");
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

function notebook(page: Page) {
  return page.locator('section[aria-labelledby^="notebook-heading"]');
}

async function openNotebookWithKeyboard(page: Page) {
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "理由を見る", exact: true }),
  );
  await expect(
    page.getByRole("heading", { name: "経済レポート" }),
  ).toBeFocused();
  await waitForPageLayout(page);
  const evidence = notebook(page)
    .locator("p")
    .filter({ hasText: "根拠：" })
    .first();
  const next = page.getByRole("button", { name: "経済レポートの次のページ" });
  for (let step = 0; step < 200 && !(await evidence.isVisible()); step++) {
    await expect(next).toBeEnabled();
    await activateWithKeyboard(page, next);
    await waitForPageLayout(page);
  }
  await expect(evidence).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "経済学ノート" }).first(),
  ).toBeVisible();
}

async function startAndAdvance(page: Page) {
  await page.goto("/");
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "はじめる", exact: true }),
  );
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeFocused();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "1か月進める" }),
  );
  await expect.poll(async () => (await savedState(page)).monthIndex).toBe(1);
}

async function expectJapaneseNotebook(page: Page, state: GameState) {
  const text = (await notebook(page).allTextContents()).join("\n");
  for (const label of [
    "用語",
    "経済のつながり",
    "政策の判断",
    "結果の振り返り",
  ])
    expect(text).toContain(label);
  expect(text).toContain("1月目の");
  expect(text).toContain("影響しています。");
  for (const entry of state.history.learningEntries ?? []) {
    for (const id of [
      entry.entryId,
      entry.conceptKey,
      entry.evidenceKey,
      entry.cause?.indicatorId,
      entry.cause?.sourceId,
    ]) {
      if (id) expect(text).not.toContain(id);
    }
  }
  expect(text).not.toMatch(/(?:policy|external|inertia|random|event|combo):/);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > innerWidth + 1,
        vertical: document.documentElement.scrollHeight > innerHeight + 1,
      })),
    )
    .toEqual({ horizontal: false, vertical: false });
}

test("learning notes are Japanese, keyboard reachable and durable after a monthly result", async ({
  page,
}, testInfo) => {
  await startAndAdvance(page);
  const state = await savedState(page);
  expect(state.learningMode).toBe("learning");
  expect(state.versions).toMatchObject({
    saveSchemaVersion: "4",
    contentVersion: "1.3.0",
  });
  const entries = state.history.learningEntries!;
  expect(entries.map((entry) => entry.kind)).toEqual([
    "term",
    "theory",
    "decision",
    "verification",
  ]);
  for (const entry of entries) {
    expect(entry).toMatchObject({
      contentVersion: "1.3.0",
      evidenceKey: "learning.evidence.contribution",
      cause: state.history.reports!.at(-1)!.topCauses[0],
    });
    expect(entry.conceptKey).toMatch(/^learning\./);
    expect(entry.concept).toBeUndefined();
    expect(entry.evidence).toBeUndefined();
    expect(entry.decisionId).toBeUndefined();
  }
  await openNotebookWithKeyboard(page);
  await expectJapaneseNotebook(page, state);
  const displayed = await notebook(page).allTextContents();
  const screenshot = testInfo.outputPath("learning-notebook-360.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("learning-notebook-360", {
    path: screenshot,
    contentType: "image/png",
  });

  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "国家ビューに戻る" }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  const reloaded = await savedState(page);
  expect(reloaded.history.learningEntries).toEqual(entries);
  expect(reloaded.economy).toEqual(state.economy);
  expect(reloaded.rng).toEqual(state.rng);
  expect(reloaded.monthIndex).toBe(1);
  await openNotebookWithKeyboard(page);
  await expectJapaneseNotebook(page, reloaded);
  expect(await notebook(page).allTextContents()).toEqual(displayed);
});

test("schema 3 legacy learning evidence migrates without changing the saved economic run", async ({
  page,
}) => {
  await startAndAdvance(page);
  // Only replace version metadata and explanation history in a real saved run.
  const legacy = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("macro-nation-games");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<GameState>((resolve, reject) => {
        const transaction = database.transaction("slots", "readwrite");
        const store = transaction.objectStore("slots");
        const request = store.get(1);
        let legacy: GameState;
        request.onsuccess = () => {
          const state = request.result.current as GameState;
          legacy = {
            ...state,
            versions: {
              ...state.versions,
              saveSchemaVersion: "3",
              contentVersion: "1.2.0",
            },
            history: {
              ...state.history,
              learningEntries: state.history.learningEntries!.map((entry) => ({
                entryId: entry.entryId,
                month: entry.month,
                kind: entry.kind,
                mode: entry.mode,
                concept: `legacy ${entry.kind}`,
                evidence: `${entry.cause!.indicatorId} / ${entry.cause!.sourceType}:${entry.cause!.sourceId} / ${entry.cause!.delta >= 0 ? "+" : ""}${entry.cause!.delta.toFixed(4)}`,
              })),
            },
          };
          store.put({ ...request.result, current: legacy });
        };
        transaction.oncomplete = () => resolve(legacy);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  await expect
    .poll(async () => (await savedState(page)).versions.saveSchemaVersion)
    .toBe("4");
  const migrated = await savedState(page);
  expect(migrated.versions.contentVersion).toBe("1.2.0");
  expect(migrated).toEqual({
    ...legacy,
    history: {
      ...legacy.history,
      appliedMilestones: legacy.history.appliedMilestones ?? [],
      reviews: legacy.history.reviews ?? [],
    },
    versions: { ...legacy.versions, saveSchemaVersion: "4" },
  });
  await openNotebookWithKeyboard(page);
  await expectJapaneseNotebook(page, migrated);
  expect((await notebook(page).allTextContents()).join("\n")).not.toContain(
    "legacy ",
  );
  await page.reload();
  expect(await savedState(page)).toEqual(migrated);
});
