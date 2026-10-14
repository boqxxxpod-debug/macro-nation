import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { waitForEnlargedText, waitForPageLayout } from "./paging";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 640 },
  { name: "desktop", width: 1366, height: 768 },
] as const;
const LABELS = {
  inflation: "物価上昇率",
  unemployment: "失業率",
  realGdp: "実質GDP",
} as const;
const ROWS = ["inflation", "unemployment", "realGdp"] as const;
const MAXIMUM_CAUSE = {
  indicatorId: "realGdp",
  sourceType: "event",
  sourceId: "現在月の最大寄与イベント",
  labelKey: "e2e.monthly.maximum",
  delta: 7,
} as const;
const CURRENT_CAUSES: MonthlyReportSnapshot["topCauses"] = [
  MAXIMUM_CAUSE,
  {
    indicatorId: "realGdp",
    sourceType: "event",
    sourceId: "現在月の成長要因A",
    labelKey: "e2e.monthly.growth.a",
    delta: 1,
  },
  {
    indicatorId: "inflation",
    sourceType: "event",
    sourceId: "現在月の物価要因A",
    labelKey: "e2e.monthly.inflation.a",
    delta: 0.006,
  },
  {
    indicatorId: "unemployment",
    sourceType: "event",
    sourceId: "現在月の雇用要因A",
    labelKey: "e2e.monthly.jobs.a",
    delta: 0.005,
  },
  {
    indicatorId: "inflation",
    sourceType: "event",
    sourceId: "現在月の物価要因B",
    labelKey: "e2e.monthly.inflation.b",
    delta: 0.009,
  },
  {
    indicatorId: "unemployment",
    sourceType: "event",
    sourceId: "現在月の雇用要因B",
    labelKey: "e2e.monthly.jobs.b",
    delta: 0.003,
  },
  {
    indicatorId: "realGdp",
    sourceType: "event",
    sourceId: "現在月の成長要因B",
    labelKey: "e2e.monthly.growth.b",
    delta: -2,
  },
];
const OLD_CAUSE = "過去月の物価要因";

test.setTimeout(120_000);

function reportDeck(page: Page) {
  return page.getByRole("region", { name: "経済レポート", exact: true });
}

function briefDeck(page: Page) {
  return page.getByRole("region", { name: "今月の報告", exact: true });
}

function evidenceButton(page: Page, row: number) {
  return page.locator(`#monthly-brief-evidence-${row}`);
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

// Keep the real game/config/clock/receipt structure; change only report fixtures
// and the explanation mode. Matching causes occur after casual mode's first
// entry so a deep link must filter the saved list before limiting its display.
async function seedReports(page: Page, missingInflation = false) {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  for (let month = 1; month <= 2; month++) {
    await page
      .getByRole("button", { name: "1か月進める", exact: true })
      .click();
    await expect
      .poll(async () => (await savedState(page)).monthIndex)
      .toBe(month);
  }
  await page.evaluate(
    async ({ causes, oldCause, missingInflation }) => {
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
            const baseline = {
              realHouseholdIncome: 100,
              realGdp: 100,
              inflation: 0.02,
              unemployment: 0.05,
              policyTrust: 60,
            };
            const updated: GameState = {
              ...state,
              learningMode: "casual",
              history: {
                ...state.history,
                reports: [
                  {
                    monthIndex: 0,
                    values: { ...baseline, inflation: 0.019 },
                    topCauses: [],
                  },
                  {
                    monthIndex: 1,
                    values: baseline,
                    topCauses: [
                      {
                        indicatorId: "inflation",
                        sourceType: "event",
                        sourceId: oldCause,
                        labelKey: "e2e.monthly.old",
                        delta: 0.001,
                      },
                    ],
                  },
                  {
                    monthIndex: 2,
                    values: {
                      ...baseline,
                      inflation: 0.035,
                      unemployment: 0.06,
                      realGdp: 102,
                    },
                    topCauses: missingInflation
                      ? causes.filter(
                          (cause) => cause.indicatorId !== "inflation",
                        )
                      : causes,
                  },
                ],
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
    },
    { causes: CURRENT_CAUSES, oldCause: OLD_CAUSE, missingInflation },
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
}

async function reach(page: Page, target: Locator, region: Locator) {
  const previous = region.getByRole("button", { name: /の前のページ$/ });
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  while (await previous.isEnabled()) {
    await previous.click();
    await waitForPageLayout(page);
  }
  const next = region.getByRole("button", { name: /の次のページ$/ });
  for (let count = 0; count < 250; count++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  await expect(target).toBeVisible();
}

async function openBrief(page: Page) {
  await page
    .getByRole("button", { name: "経済指標を見る", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "ホームの詳細" })
    .selectOption("report");
  await waitForPageLayout(page);
}

async function expectFits(page: Page, region: Locator) {
  await expect
    .poll(() =>
      region.evaluate((deck) => {
        const problems: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth + 1)
          problems.push("document width");
        if (document.documentElement.scrollHeight > innerHeight + 1)
          problems.push("document height");
        for (const element of deck.querySelectorAll<HTMLElement>(
          "[data-page-current], [data-page-item], button, select",
        )) {
          if (
            element.closest("[hidden], [inert]") ||
            !element.getClientRects().length
          )
            continue;
          const bounds = element.getBoundingClientRect();
          const label = element.getAttribute("aria-label") ?? element.className;
          if (element.scrollWidth > element.clientWidth + 2)
            problems.push(`${label}: clipped width`);
          if (element.scrollHeight > element.clientHeight + 2)
            problems.push(`${label}: clipped height`);
          if (
            bounds.left < -1 ||
            bounds.right > innerWidth + 1 ||
            bounds.top < -1 ||
            bounds.bottom > innerHeight + 1
          )
            problems.push(`${label}: outside viewport`);
          if (
            element instanceof HTMLButtonElement ||
            element instanceof HTMLSelectElement
          ) {
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
      }),
    )
    .toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = "artifacts/issue-107";
  await mkdir(directory, { recursive: true });
  const path = join(
    directory,
    `${name}-${testInfo.project.name}-retry-${testInfo.retry}.png`,
  );
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function expectTarget(page: Page, row: number, month = 2) {
  const indicator = ROWS[row]!;
  const url = new URL(page.url());
  expect(url.pathname).toBe("/game/1/report");
  expect(url.searchParams.get("month")).toBe(String(month));
  expect(url.searchParams.get("indicator")).toBe(indicator);
  expect(url.searchParams.get("row")).toBe(String(row));
  if (row === 2) {
    for (const field of [
      "sourceType",
      "sourceId",
      "labelKey",
      "delta",
    ] as const)
      expect(url.searchParams.get(field)).toBe(String(MAXIMUM_CAUSE[field]));
  } else {
    expect(url.searchParams.has("sourceId")).toBe(false);
  }
  const region = reportDeck(page);
  await expect(
    region.getByRole("combobox", { name: "経済レポートのカテゴリ" }),
  ).toHaveValue("causes");
  await expect(region.locator(".page-content")).toHaveAttribute(
    "data-page-category",
    "causes",
  );
  await expect(region.getByRole("status")).toContainText(`${month}月目`);
  await expect(region.getByRole("status")).toContainText(LABELS[indicator]);
}

async function expectMatchingCauses(page: Page, row: number) {
  const indicator = ROWS[row]!;
  const text = (
    await reportDeck(page)
      .locator('[data-page-item][data-page-category="causes"]')
      .allTextContents()
  ).join("\n");
  const matching =
    row === 2
      ? [MAXIMUM_CAUSE]
      : CURRENT_CAUSES.filter((cause) => cause.indicatorId === indicator);
  for (const cause of matching) expect(text).toContain(cause.sourceId);
  for (const cause of CURRENT_CAUSES.filter(
    (cause) => !matching.includes(cause),
  ))
    expect(text).not.toContain(cause.sourceId);
  expect(text).not.toContain(OLD_CAUSE);
  if (row !== 2) {
    const sorted = [...matching].sort(
      (a, b) => Math.abs(b.delta) - Math.abs(a.delta),
    );
    expect(text.indexOf(sorted[0]!.sourceId)).toBeLessThan(
      text.indexOf(sorted[1]!.sourceId),
    );
  }
}

async function expectReturn(page: Page, row: number, sourcePage?: string) {
  await expect(
    page.getByRole("heading", { name: "経済指標", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "ホームの詳細" }),
  ).toHaveValue("report");
  await waitForPageLayout(page);
  await expect(evidenceButton(page, row)).toBeVisible();
  await expect(evidenceButton(page, row)).toBeFocused();
  if (sourcePage !== undefined)
    await expect(briefDeck(page).locator(".page-content")).toHaveAttribute(
      "data-page-current",
      sourcePage,
    );
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} monthly evidence`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("all three rows open their saved evidence and restore the source page and focus", async ({
      page,
    }, testInfo) => {
      await seedReports(page);
      const initial = await savedState(page);
      await openBrief(page);
      for (const [row, indicator] of ROWS.entries()) {
        const source = evidenceButton(page, row);
        await reach(page, source, briefDeck(page));
        await expect(source).toHaveAccessibleName(
          `${row + 1}行目・${LABELS[indicator]}の根拠を見る`,
        );
        await expectFits(page, briefDeck(page));
        const sourcePage = (await briefDeck(page)
          .locator(".page-content")
          .getAttribute("data-page-current"))!;
        await capture(page, testInfo, `${viewport.name}-row-${row + 1}-source`);
        if (row === 1) await source.click();
        else {
          await source.focus();
          await page.keyboard.press(row === 0 ? "Enter" : "Space");
        }
        await waitForPageLayout(page);
        await expectTarget(page, row);
        await expect(reportDeck(page).locator(".page-content")).toBeFocused();
        await expectMatchingCauses(page, row);
        await expectFits(page, reportDeck(page));
        await capture(
          page,
          testInfo,
          `${viewport.name}-row-${row + 1}-evidence`,
        );
        const back = page.getByRole("button", {
          name: "ホームの報告へ戻る",
          exact: true,
        });
        await expect(back).toBeVisible();
        await back.focus();
        await page.keyboard.press("Enter");
        await expectReturn(page, row, sourcePage);
        await expectFits(page, briefDeck(page));
        expect(await savedState(page)).toEqual(initial);
      }
      const source = evidenceButton(page, 1);
      await reach(page, source, briefDeck(page));
      await source.click();
      await page.reload();
      await waitForPageLayout(page);
      await expectTarget(page, 1);
      await expectMatchingCauses(page, 1);
      await page.goBack();
      await expectReturn(page, 1);
      await page.goForward();
      await waitForPageLayout(page);
      await expectTarget(page, 1);
      await expectMatchingCauses(page, 1);
      await page
        .getByRole("button", {
          name: "すべての変化の理由を見る",
          exact: true,
        })
        .click();
      await waitForPageLayout(page);
      expect(new URL(page.url()).search).toBe("");
      await expect(
        reportDeck(page).getByRole("combobox", {
          name: "経済レポートのカテゴリ",
        }),
      ).toHaveValue("causes");
      await expect(reportDeck(page).getByRole("status")).not.toContainText(
        "2月目",
      );
      await page.getByRole("button", { name: "経済指標", exact: true }).click();
      await page.getByRole("button", { name: "レポート", exact: true }).click();
      await waitForPageLayout(page);
      expect(new URL(page.url()).search).toBe("");
      await expect(
        reportDeck(page).getByRole("combobox", {
          name: "経済レポートのカテゴリ",
        }),
      ).toHaveValue("trend");
      expect(await savedState(page)).toEqual(initial);
    });

    test("missing cause records explain the gap and offer trend/history without showing another metric", async ({
      page,
    }, testInfo) => {
      await seedReports(page, true);
      const initial = await savedState(page);
      await openBrief(page);
      const source = evidenceButton(page, 0);
      await reach(page, source, briefDeck(page));
      await source.click();
      await waitForPageLayout(page);
      await expectTarget(page, 0);
      await expect(reportDeck(page).locator(".page-content")).toBeFocused();
      const region = reportDeck(page);
      const message = region.getByText(
        "この月の保存済み報告には、この指標の因果記録がありません。",
        { exact: true },
      );
      await reach(page, message, region);
      await expect(message).toBeVisible();
      const text = (
        await region
          .locator('[data-page-item][data-page-category="causes"]')
          .allTextContents()
      ).join("\n");
      for (const cause of CURRENT_CAUSES)
        expect(text).not.toContain(cause.sourceId);
      await expectFits(page, region);
      await capture(page, testInfo, `${viewport.name}-missing-cause`);
      for (const [name, category] of [
        ["推移を確認する", "trend"],
        ["国家史を確認する", "history"],
      ] as const) {
        const button = region.getByRole("button", { name, exact: true });
        await reach(page, button, region);
        await button.focus();
        await page.keyboard.press("Enter");
        await waitForPageLayout(page);
        await expect(
          region.getByRole("combobox", { name: "経済レポートのカテゴリ" }),
        ).toHaveValue(category);
        await expect(
          page.getByRole("button", { name: "ホームの報告へ戻る", exact: true }),
        ).toBeVisible();
        await region
          .getByRole("combobox", { name: "経済レポートのカテゴリ" })
          .selectOption("causes");
        await waitForPageLayout(page);
      }
      await page
        .getByRole("button", { name: "ホームの報告へ戻る", exact: true })
        .click();
      await expectReturn(page, 0);
      expect(await savedState(page)).toEqual(initial);
    });

    test("old and absent report months keep their own evidence through reload", async ({
      page,
    }) => {
      await seedReports(page);
      const initial = await savedState(page);
      await page.goto("/game/1/report?month=1&indicator=inflation&row=0");
      await waitForPageLayout(page);
      await expectTarget(page, 0, 1);
      const region = reportDeck(page);
      const old = region.getByText(new RegExp(OLD_CAUSE));
      await reach(page, old, region);
      await expect(old).toBeVisible();
      const oldText = (
        await region
          .locator('[data-page-item][data-page-category="causes"]')
          .allTextContents()
      ).join("\n");
      for (const cause of CURRENT_CAUSES)
        expect(oldText).not.toContain(cause.sourceId);
      await page.reload();
      await waitForPageLayout(page);
      await expectTarget(page, 0, 1);
      await page
        .getByRole("button", { name: "ホームの報告へ戻る", exact: true })
        .click();
      await expectReturn(page, 0);
      const returnURL = new URL(page.url());
      expect(returnURL.searchParams.get("reportMonth")).toBe("1");
      expect(returnURL.searchParams.get("reportRow")).toBe("0");

      await page.goto("/game/1/report?month=999&indicator=inflation&row=0");
      await waitForPageLayout(page);
      await expectTarget(page, 0, 999);
      const missing = reportDeck(page).getByText(
        "この月の報告が保存されていないため、根拠を表示できません。",
        { exact: true },
      );
      await reach(page, missing, reportDeck(page));
      await expect(missing).toBeVisible();
      const missingText = (
        await reportDeck(page)
          .locator('[data-page-item][data-page-category="causes"]')
          .allTextContents()
      ).join("\n");
      expect(missingText).not.toContain(OLD_CAUSE);
      for (const cause of CURRENT_CAUSES)
        expect(missingText).not.toContain(cause.sourceId);
      await page.reload();
      await waitForPageLayout(page);
      await expectTarget(page, 0, 999);
      await page
        .getByRole("button", {
          name: "ホームの報告へ戻る",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("combobox", { name: "ホームの詳細" }),
      ).toHaveValue("report");
      await waitForPageLayout(page);
      await expect(page.locator("#monthly-brief-heading")).toBeVisible();
      await expect(page.locator("#monthly-brief-heading")).toBeFocused();
      await expect(page.locator('[id^="monthly-brief-evidence-"]')).toHaveCount(
        0,
      );
      expect(await savedState(page)).toEqual(initial);
    });
  });
}

test("200% monthly evidence remains keyboard reachable and restores the third-row source", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await seedReports(page);
  const initial = await savedState(page);
  await openBrief(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await waitForEnlargedText(page);
  await waitForPageLayout(page);
  const source = evidenceButton(page, 2);
  await source.focus();
  await page.keyboard.press("Enter");
  await waitForPageLayout(page);
  await expectTarget(page, 2);
  await expect(
    reportDeck(page).locator('[data-page-category-start="causes"]'),
  ).toBeFocused();
  await expectMatchingCauses(page, 2);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
  await capture(page, testInfo, "mobile-evidence-200-percent");
  const back = page.getByRole("button", {
    name: "ホームの報告へ戻る",
    exact: true,
  });
  await back.focus();
  await page.keyboard.press("Enter");
  await expectReturn(page, 2);
  await expect(source).toBeFocused();
  expect(await savedState(page)).toEqual(initial);
});
