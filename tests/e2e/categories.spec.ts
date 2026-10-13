import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { CausalRef, GameState } from "@macro-nation/domain";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { waitForEnlargedText, waitForPageLayout } from "./paging";

const PREVIEW_CATEGORIES = [
  ["summary", "判断要約"],
  ["comparison", "現状維持との比較"],
  ["forecast", "長期見通し"],
  ["alternatives", "別案"],
  ["experts", "専門家"],
] as const;
const REPORT_CATEGORIES = [
  ["trend", "推移"],
  ["causes", "変化の理由"],
  ["voices", "国の声"],
  ["history", "国家史"],
  ["learning", "学習内容"],
  ["news", "経済ニュース"],
] as const;
const VIEWPORTS = [
  { name: "mobile", width: 360, height: 640 },
  { name: "desktop", width: 1366, height: 768 },
] as const;
const REVIEW_LABEL = "費用・副作用・警告を確認しました";
const MAX_PAGE_STEPS = 250;

test.setTimeout(120_000);

function deck(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

function categorySelect(region: Locator, name: string) {
  return region.getByRole("combobox", { name: `${name}のカテゴリ` });
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

async function startGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeFocused();
}

// Supply a recent, valid reaction to a real monthly report so the optional
// voices category is exercised without depending on random simulation output.
async function seedReportVoice(page: Page) {
  await page.evaluate(async () => {
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
          const state = request.result.current as GameState;
          const report = state.history.reports!.at(-1)!;
          const cause = report.topCauses[0]!;
          const reactions: NonNullable<typeof report.reactions> = [{
            reactionId: "category-voice-fixture",
            month: state.monthIndex,
            audience: "citizens",
            direction: 1,
            strength: 2,
            lagMonths: 1,
            representativeTopicKey: "jobs",
            causeRefs: [{
              sourceType: cause.sourceType as CausalRef["sourceType"],
              sourceId: cause.sourceId,
              labelKey: cause.labelKey,
              confidence: "high",
            }],
          }];
          const updated: GameState = {
            ...state,
            history: {
              ...state.history,
              reports: state.history.reports!.map((item, index, reports) =>
                index === reports.length - 1 ? { ...item, reactions } : item,
              ),
            },
          };
          store.put({ ...request.result, current: updated });
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
}

async function captureCategory(page: Page, testInfo: TestInfo, name: string) {
  const directory = "artifacts/issue-89";
  await mkdir(directory, { recursive: true });
  const path = join(directory, `categories-${name}-${testInfo.project.name}-retry-${testInfo.retry}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function reach(page: Page, target: Locator, region?: Locator) {
  const next = (region ?? page).getByRole("button", { name: /の次のページ$/ });
  for (let step = 0; step < MAX_PAGE_STEPS; step++) {
    await waitForPageLayout(page);
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
  }
  await expect(target).toBeVisible();
}

async function openPreview(page: Page) {
  await page.getByRole("button", { name: "政策を考える", exact: true }).click();
  const rate = page.getByRole("spinbutton", { name: "政策金利（年率・%）" });
  await reach(page, rate);
  await rate.fill("5");
  await page.getByRole("button", { name: "見通しを確認" }).click();
  await expect(page.getByRole("heading", { name: "政策の見通し" })).toBeFocused();
  await waitForPageLayout(page);
}

async function expectFits(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate((name) => {
        const problems: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth + 1)
          problems.push("document width");
        if (document.documentElement.scrollHeight > innerHeight + 1)
          problems.push("document height");
        const region = Array.from(document.querySelectorAll<HTMLElement>("[data-page-deck]"))
          .find((element) => element.getAttribute("aria-label") === name)!;
        for (const element of region.querySelectorAll<HTMLElement>(
          "[data-page-current], [data-page-item], .page-category-navigation, button, select",
        )) {
          if (element.closest("[hidden], [inert]") || !element.getClientRects().length)
            continue;
          const bounds = element.getBoundingClientRect();
          const label = element.getAttribute("aria-label") ?? element.className;
          if (element.scrollWidth > element.clientWidth + 2)
            problems.push(`${label}: clipped width`);
          if (element.scrollHeight > element.clientHeight + 2)
            problems.push(`${label}: clipped height`);
          if (bounds.left < -1 || bounds.right > innerWidth + 1 ||
              bounds.top < -1 || bounds.bottom > innerHeight + 1)
            problems.push(`${label}: outside viewport`);
          if (element instanceof HTMLButtonElement || element instanceof HTMLSelectElement) {
            if (bounds.width < 43.5 || bounds.height < 43.5)
              problems.push(`${label}: tap target`);
            const hit = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            );
            if (hit !== element && !element.contains(hit))
              problems.push(`${label}: covered`);
          }
        }
        return problems;
      }, name),
    )
    .toEqual([]);
}

async function expectLocation(region: Locator, name: string, id: string, label: string, first = false) {
  const content = region.locator(".page-content");
  await expect(categorySelect(region, name)).toHaveValue(id);
  await expect(content).toHaveAttribute("data-page-category", id);
  await expect(content).toHaveAttribute("aria-label", `${name}の内容`);
  await expect(content).toHaveAccessibleDescription(new RegExp(label));
  expect(await content.locator(":scope > [data-page-item]:not([hidden])").evaluateAll((items) =>
    [...new Set(items.map((item) => item.getAttribute("data-page-category")))],
  )).toEqual([id]);
  const status = region.getByRole("status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText(label);
  await expect(status).toHaveText(new RegExp(`${label}.*${first ? "1" : "\\d+"} / \\d+ページ`));
}

async function selectCategory(page: Page, name: string, id: string, label: string) {
  const region = deck(page, name);
  await categorySelect(region, name).selectOption(id);
  await waitForPageLayout(page);
  await expectLocation(region, name, id, label, true);
  await expect(region.locator(".page-content")).toBeFocused();
  await expectFits(page, name);
}

async function checkCategories(
  page: Page,
  name: string,
  categories: readonly (readonly [string, string])[],
  testInfo: TestInfo,
) {
  const region = deck(page, name);
  const select = categorySelect(region, name);
  expect(await select.locator("option").evaluateAll((options) =>
    options.map((option) => [(option as HTMLOptionElement).value, option.textContent]),
  )).toEqual(categories.map(([id, label]) => [id, label]));

  // Each direct jump reaches the category's first page. Going back from there
  // crosses to the preceding category's last page; going forward returns here.
  for (const [index, [id, label]] of categories.entries()) {
    await selectCategory(page, name, id, label);
    if (page.viewportSize()?.width === 360)
      await captureCategory(page, testInfo, `${name}-${id}-360`);
    const previous = region.getByRole("button", { name: `${name}の前のページ` });
    const next = region.getByRole("button", { name: `${name}の次のページ` });
    if (index === 0) {
      await expect(previous).toBeDisabled();
      continue;
    }
    const globalPage = Number(await region.locator(".page-content").getAttribute("data-page-current"));
    await previous.focus();
    await page.keyboard.press("Enter");
    await waitForPageLayout(page);
    const [previousId, previousLabel] = categories[index - 1]!;
    await expectLocation(region, name, previousId, previousLabel);
    await expect(region.locator(".page-content")).toHaveAttribute("data-page-current", String(globalPage - 1));
    await expect(region.locator(".page-content")).toBeFocused();
    await expectFits(page, name);
    await next.focus();
    await page.keyboard.press("Enter");
    await waitForPageLayout(page);
    await expectLocation(region, name, id, label, true);
    await expect(region.locator(".page-content")).toHaveAttribute("data-page-current", String(globalPage));
    await expect(region.locator(".page-content")).toBeFocused();
  }
  await selectCategory(page, name, categories[0]![0], categories[0]![1]);
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await waitForPageLayout(page);
  await expectLocation(region, name, categories[1]![0], categories[1]![1], true);
  await expect(region.locator(".page-content")).toBeFocused();
  for (let count = 0; count < 8; count++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() =>
      !!document.activeElement?.closest("[hidden], [inert]"),
    )).toBe(false);
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} category navigation`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("policy categories preserve acknowledgement, projections and saved state", async ({ page }, testInfo) => {
      await startGame(page);
      const initial = await savedState(page);
      await openPreview(page);
      const region = deck(page, "政策の見通し");
      const confirm = region.getByRole("button", { name: "政策を確定する" });
      await expect(confirm).toBeDisabled();
      await checkCategories(page, "政策の見通し", PREVIEW_CATEGORIES, testInfo);
      await expect(confirm).toBeDisabled();
      await selectCategory(page, "政策の見通し", "summary", "判断要約");
      const acknowledgement = region.getByRole("checkbox", { name: REVIEW_LABEL });
      await reach(page, acknowledgement, region);
      await acknowledgement.check();
      await waitForPageLayout(page);
      await expect(confirm).toBeEnabled();
      const originalText = await region.locator("[data-page-item]").allTextContents();
      for (const [id, label] of PREVIEW_CATEGORIES) {
        await selectCategory(page, "政策の見通し", id, label);
        await expect(confirm).toBeEnabled();
      }
      await selectCategory(page, "政策の見通し", "summary", "判断要約");
      await reach(page, acknowledgement, region);
      await expect(acknowledgement).toBeChecked();
      expect(await region.locator("[data-page-item]").allTextContents()).toEqual(originalText);
      expect(await savedState(page)).toEqual(initial);
    });

    test("report categories retain explanations, learning records and saved state", async ({ page }, testInfo) => {
      await startGame(page);
      await page.getByRole("button", { name: "1か月進める" }).click();
      await expect.poll(async () => (await savedState(page)).monthIndex).toBe(1);
      await seedReportVoice(page);
      const initial = await savedState(page);
      await page.getByRole("button", { name: "理由を見る", exact: true }).click();
      await waitForPageLayout(page);
      const region = deck(page, "経済レポート");
      const originalText = await region.locator("[data-page-item]").allTextContents();
      await checkCategories(page, "経済レポート", REPORT_CATEGORIES, testInfo);
      await selectCategory(page, "経済レポート", "learning", "学習内容");
      for (const name of ["思想比較", "専門家の予測記録", "経済学ノート"]) {
        await reach(page, region.getByRole("heading", { name, exact: true }).first(), region);
        await expect(categorySelect(region, "経済レポート")).toHaveValue("learning");
        await expectFits(page, "経済レポート");
      }
      expect(await region.locator("[data-page-item]").allTextContents()).toEqual(originalText);
      expect(await savedState(page)).toEqual(initial);
    });
  });
}

test("200% text keeps category anchors and policy confirmation keyboard reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await startGame(page);
  const initial = await savedState(page);
  await openPreview(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await waitForEnlargedText(page);
  await waitForPageLayout(page);
  const region = deck(page, "政策の見通し");
  await expect(region).toHaveClass(/page-deck-expanded/);
  for (const [id, label] of PREVIEW_CATEGORIES) {
    await categorySelect(region, "政策の見通し").selectOption(id);
    const anchor = region.locator(`[data-page-category-start="${id}"]`);
    await expect(anchor).toBeFocused();
    await expect(anchor).toHaveAttribute("aria-label", label);
    await expect(region.getByRole("status")).toHaveText(`${label} · 全文を表示しています`);
    await expect.poll(() => anchor.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= -1 && bounds.top < innerHeight;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth + 1,
    )).toBe(true);
  }
  for (const name of ["政策の見通しの前のページ", "政策の見通しの次のページ"]) {
    const control = region.getByRole("button", { name, includeHidden: true });
    await expect(control).toBeHidden();
    await expect(control).toBeDisabled();
  }
  await captureCategory(page, testInfo, "policy-200-percent");
  const acknowledgement = region.getByRole("checkbox", { name: REVIEW_LABEL });
  await acknowledgement.focus();
  await page.keyboard.press("Space");
  await expect(acknowledgement).toBeChecked();
  const confirm = region.getByRole("button", { name: "政策を確定する" });
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await expect(confirm).toBeEnabled();
  expect(await savedState(page)).toEqual(initial);
});

test("200% report text keeps every category anchor reachable without changing the run", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await startGame(page);
  await page.getByRole("button", { name: "1か月進める" }).click();
  await expect.poll(async () => (await savedState(page)).monthIndex).toBe(1);
  await seedReportVoice(page);
  const initial = await savedState(page);
  await page.getByRole("button", { name: "理由を見る", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await waitForEnlargedText(page);
  await waitForPageLayout(page);
  const region = deck(page, "経済レポート");
  await expect(region).toHaveClass(/page-deck-expanded/);
  for (const [id, label] of REPORT_CATEGORIES) {
    await categorySelect(region, "経済レポート").selectOption(id);
    const anchor = region.locator(`[data-page-category-start="${id}"]`);
    await expect(anchor).toBeFocused();
    await expect(anchor).toHaveAttribute("aria-label", label);
    await expect(region.getByRole("status")).toHaveText(`${label} · 全文を表示しています`);
    await expect.poll(() => anchor.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= -1 && bounds.top < innerHeight;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth + 1,
    )).toBe(true);
    if (id === "learning") await captureCategory(page, testInfo, "report-learning-200-percent");
  }
  await expect(region.locator("[data-page-item][hidden], [data-page-item][inert]")).toHaveCount(0);
  expect(await savedState(page)).toEqual(initial);
});
