import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { waitForPageLayout } from "./paging";

const SEED = "playtest-scn01-4y-20261014";
const VIEWPORTS = [
  { name: "mobile", width: 360, height: 640 },
  { name: "desktop", width: 1366, height: 768 },
] as const;
const LABELS = {
  inflation: "物価上昇率",
  realGdp: "実質GDP",
  unemployment: "失業率",
} as const;
type Indicator = keyof typeof LABELS;

test.setTimeout(180_000);

function reportDeck(page: Page) {
  return page.getByRole("region", { name: "経済レポート", exact: true });
}

function briefDeck(page: Page) {
  return page.getByRole("region", { name: "今月の報告", exact: true });
}

/** Inspect UI-created saves only. This test never changes browser storage. */
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
          .transaction("slots", "readonly")
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

async function reach(page: Page, target: Locator, region?: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const scope = region ?? page;
  const content = scope.locator(".page-content:visible").first();
  const maximumPages = await content
    .locator(":scope > [data-page-item]")
    .count();
  const currentPage = async () =>
    Number(await content.getAttribute("data-page-current"));
  const previous = scope.getByRole("button", { name: /の前のページ$/ });
  for (
    let step = 0;
    step < maximumPages && (await previous.isEnabled());
    step++
  ) {
    const before = await currentPage();
    await previous.click();
    await waitForPageLayout(page);
    await expect.poll(currentPage).toBeLessThan(before);
  }
  const next = scope.getByRole("button", { name: /の次のページ$/ });
  for (let step = 0; step < maximumPages; step++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    const before = await currentPage();
    await next.click();
    await waitForPageLayout(page);
    await expect.poll(currentPage).toBeGreaterThan(before);
  }
  await expect(target).toBeVisible();
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
          const name = element.getAttribute("aria-label") ?? element.className;
          if (element.scrollWidth > element.clientWidth + 2)
            problems.push(`${name}: clipped width`);
          if (element.scrollHeight > element.clientHeight + 2)
            problems.push(`${name}: clipped height`);
          if (
            bounds.left < -1 ||
            bounds.right > innerWidth + 1 ||
            bounds.top < -1 ||
            bounds.bottom > innerHeight + 1
          )
            problems.push(`${name}: outside viewport`);
          if (
            element instanceof HTMLButtonElement ||
            element instanceof HTMLSelectElement
          ) {
            if (bounds.width < 43.5 || bounds.height < 43.5)
              problems.push(`${name}: tap target`);
            const hit = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            );
            if (hit !== element && !element.contains(hit))
              problems.push(`${name}: covered`);
          }
        }
        return problems;
      }),
    )
    .toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const directory = resolve("artifacts/issue-119");
  await mkdir(directory, { recursive: true });
  const path = resolve(
    directory,
    `${name}-${testInfo.project.name}-retry-${testInfo.retry}.png`,
  );
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  const directory = resolve("artifacts/issue-119");
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${name}-${testInfo.project.name}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
}

async function startReproduction(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const [name, value] of [
    ["シナリオ", "SCN-01"],
    ["難易度", "intro"],
    ["説明モード", "learning"],
  ] as const) {
    const input = page.getByRole("combobox", { name, exact: true });
    await reach(page, input);
    await input.selectOption(value);
  }
  const duration = page.getByRole("radio", { name: /4年（48か月）/ });
  await reach(page, duration);
  await duration.check();
  const seed = page.getByRole("textbox", { name: "再現用コード（任意）" });
  await reach(page, seed);
  await seed.fill(SEED);
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();

  await page.getByRole("button", { name: "政策を考える", exact: true }).click();
  const kind = page.getByRole("combobox", { name: "政策の種類" });
  await reach(page, kind);
  await kind.selectOption({ label: "公共事業" });
  const value = page.getByRole("spinbutton", {
    name: "公共事業の追加規模（年間GDP比・%）",
  });
  await reach(page, value);
  await value.fill("1");
  const timing = page.getByRole("combobox", { name: "政策を始める時期" });
  await reach(page, timing);
  await timing.selectOption("0");
  await expect(page.locator(".expert-picker input:checked")).toHaveCount(1);
  for (const name of [/水城 静香/, /大蔵 堅/]) {
    const expert = page.getByRole("checkbox", { name });
    await reach(page, expert);
    await expert.check();
  }
  await expect(page.locator(".expert-picker input:checked")).toHaveCount(3);
  await page.getByRole("button", { name: "見通しを確認" }).click();
  await expect(
    page.getByRole("heading", { name: "政策の見通し", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const acknowledge = page.getByRole("checkbox", {
    name: "費用・副作用・警告を確認しました",
  });
  await reach(page, acknowledge);
  await acknowledge.check();
  await page.getByRole("button", { name: "政策を確定する" }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  const guidance = page.getByRole("dialog", { name: "運営の案内" });
  if (await guidance.isVisible())
    await guidance.getByRole("button", { name: "詳細を閉じる" }).click();
  const state = await savedState(page);
  expect(state).toMatchObject({
    scenarioId: "SCN-01",
    difficulty: "intro",
    durationMode: "short",
    learningMode: "learning",
    monthIndex: 0,
    rng: { rootSeed: SEED },
    clock: { endMonth: 48, progressionMode: "manual" },
  });
  const decision = [...state.policies.active, ...state.policies.reserved].find(
    (policy) => policy.type === "publicWorks",
  );
  expect(decision).toMatchObject({
    type: "publicWorks",
    activationMonth: 0,
    selectedExpertIds: ["macro", "centralBank", "fiscal"],
  });
  return state;
}

async function advance(page: Page, month: number) {
  await page.getByRole("button", { name: "1か月進める", exact: true }).click();
  await expect
    .poll(async () => (await savedState(page)).monthIndex)
    .toBe(month);
  return savedState(page);
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

function traceFor(report: MonthlyReportSnapshot, indicator: Indicator) {
  expect(report.causalTrace?.completeness).toBe("complete");
  const stages = report.causalTrace!.indicators.filter(
    (item) => item.indicatorId === indicator,
  );
  expect(stages.length).toBeGreaterThan(0);
  const causes = stages
    .flatMap((item) => item.contributions)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  const before = stages[0]!.beforeValue;
  const after = stages.at(-1)!.afterValue;
  const total = stages.reduce((sum, item) => sum + item.totalDelta, 0);
  const sum = causes.reduce((sum, item) => sum + item.delta, 0);
  expect(Math.abs(after - before - total)).toBeLessThanOrEqual(
    Math.max(1e-9, Math.abs(total) * 1e-8),
  );
  expect(Math.abs(sum - total)).toBeLessThanOrEqual(
    Math.max(1e-9, Math.abs(total) * 1e-8),
  );
  return { before, after, total, sum, causes };
}

async function expectTarget(page: Page, month: number, indicator: Indicator) {
  const url = new URL(page.url());
  expect(url.pathname).toBe("/game/1/report");
  expect(url.searchParams.get("month")).toBe(String(month));
  expect(url.searchParams.get("indicator")).toBe(indicator);
  expect(url.searchParams.get("row")).toBe("0");
  await expect(
    reportDeck(page).getByRole("combobox", { name: "経済レポートのカテゴリ" }),
  ).toHaveValue("causes");
  await expect(reportDeck(page).getByRole("status")).toContainText(
    `${month}月目`,
  );
  await expect(reportDeck(page).getByRole("status")).toContainText(
    LABELS[indicator],
  );
}

async function selectReport(page: Page, month: number, indicator: Indicator) {
  const monthInput = page.getByRole("combobox", {
    name: "報告の月",
    exact: true,
  });
  await reach(page, monthInput, reportDeck(page));
  await monthInput.selectOption(String(month));
  await waitForPageLayout(page);
  const indicatorInput = page.getByRole("combobox", {
    name: "報告の指標",
    exact: true,
  });
  await reach(page, indicatorInput, reportDeck(page));
  await indicatorInput.selectOption(indicator);
  await waitForPageLayout(page);
  await expectTarget(page, month, indicator);
}

async function expectSavedBreakdown(
  page: Page,
  report: MonthlyReportSnapshot,
  indicator: Indicator,
  testInfo: TestInfo,
  prefix: string,
) {
  const trace = traceFor(report, indicator);
  const region = reportDeck(page);
  const heading = region
    .getByRole("heading", {
      name: `${report.monthIndex}月目・${LABELS[indicator]}の変化の理由`,
      exact: true,
    })
    .first();
  await reach(page, heading, region);
  await expect(heading).toBeVisible();
  await expect(region.locator("[data-report-cause]")).toHaveCount(
    Math.min(3, trace.causes.length),
  );
  const text = (
    await region
      .locator('[data-page-item][data-page-category="causes"]')
      .allTextContents()
  ).join("\n");
  expect(text).toContain("因果記録の前値：");
  expect(text).toContain("後値：");
  expect(text).toContain("記録された変化：");
  expect(text).toContain("保存済み寄与の合計：");
  expect(text).toContain("合計の照合：一致");
  expect(text).toContain(indicator === "realGdp" ? "指数" : "ポイント");
  if (indicator !== "realGdp") expect(text).toContain("%");
  const numbers = (value: string) =>
    [...value.matchAll(/[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map((match) =>
      Number(match[0]),
    );
  const scale = indicator === "realGdp" ? 1 : 100;
  const summary = numbers(
    (await region.locator("[data-report-summary]").textContent()) ?? "",
  );
  const totals = numbers(
    (await region.locator("[data-report-total]").textContent()) ?? "",
  );
  expect(summary).toHaveLength(2);
  expect(totals).toHaveLength(2);
  for (const [displayed, saved] of [
    [summary[0]!, trace.before],
    [summary[1]!, trace.after],
    [totals[0]!, trace.total],
    [totals[1]!, trace.sum],
  ])
    expect(Math.abs(displayed! - saved! * scale)).toBeLessThanOrEqual(0.000001);
  await expectFits(page, region);
  await capture(page, testInfo, `${prefix}-summary`);
  if (trace.causes.length > 3) {
    const expand = region.getByRole("button", {
      name: `保存された寄与をすべて表示（${trace.causes.length}件）`,
      exact: true,
    });
    await reach(page, expand, region);
    await expand.click();
    await waitForPageLayout(page);
  }
  await expect(region.locator("[data-report-cause]")).toHaveCount(
    trace.causes.length,
  );
  const displayed = await region
    .locator("[data-report-cause]")
    .allTextContents();
  expect(displayed.every((cause) => cause.includes(LABELS[indicator]))).toBe(
    true,
  );
  expect(
    await region
      .locator("[data-report-cause]")
      .evaluateAll((causes) =>
        causes.map((cause) => cause.getAttribute("data-report-cause")),
      ),
  ).toEqual(trace.causes.map((cause) => cause.sourceId));
  for (const [index, cause] of trace.causes.entries()) {
    const value = numbers(displayed[index]!).at(-1)!;
    expect(Math.abs(value - cause.delta * scale)).toBeLessThanOrEqual(0.000001);
  }
  const category = region.getByRole("combobox", {
    name: "経済レポートのカテゴリ",
  });
  await category.selectOption("causes");
  await waitForPageLayout(page);
  const next = region.getByRole("button", { name: "経済レポートの次のページ" });
  const status = region.getByRole("status");
  const initialStatus = await status.innerText();
  const position = /·\s*(\d+)\s*\/\s*(\d+)ページ$/.exec(initialStatus);
  expect(
    position,
    `Expected a paginated cause category: ${initialStatus}`,
  ).not.toBeNull();
  expect(Number(position![1])).toBe(1);
  const pageCount = Number(position![2]);
  for (let current = 1; current <= pageCount; current++) {
    await expect(category).toHaveValue("causes");
    await expect(status).toHaveText(
      new RegExp(`·\\s*${current}\\s*/\\s*${pageCount}ページ$`),
    );
    await expectFits(page, region);
    if ([1, Math.ceil(pageCount / 2), pageCount].includes(current))
      await capture(page, testInfo, `${prefix}-all-page-${current}`);
    if (current === pageCount) break;
    await expect(next).toBeEnabled();
    await next.click();
    await waitForPageLayout(page);
  }
  if (await next.isEnabled()) {
    await next.click();
    await waitForPageLayout(page);
    await expect(category).not.toHaveValue("causes");
  }
  return trace;
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} complete report breakdown`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("real SCN-01 policy results retain every metric and month through evidence, selection and reload", async ({
      page,
    }, testInfo) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      const initial = await startReproduction(page);
      expect(initial.history.reports?.[0]?.causalTrace?.completeness).toBe(
        "initial",
      );
      const monthOne = await advance(page, 1);
      const firstReport = monthOne.history.reports!.find(
        (report) => report.monthIndex === 1,
      )!;
      expect(
        firstReport.causalTrace!.indicators.flatMap(
          (item) => item.contributions,
        ).length,
      ).toBeGreaterThan(firstReport.topCauses.length);
      await openBrief(page);

      const firstTwo = page.locator(
        "#monthly-brief-evidence-0, #monthly-brief-evidence-1",
      );
      const names = await firstTwo.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      );
      expect(names.some((name) => name?.includes(LABELS.inflation))).toBe(true);
      expect(names.some((name) => name?.includes(LABELS.realGdp))).toBe(true);
      for (const indicator of ["inflation", "realGdp"] as const) {
        const source = briefDeck(page).getByRole("button", {
          name: new RegExp(`行目・${LABELS[indicator]}の根拠を見る$`),
        });
        await reach(page, source, briefDeck(page));
        await expectFits(page, briefDeck(page));
        await capture(page, testInfo, `${viewport.name}-${indicator}-brief`);
        await source.click();
        await waitForPageLayout(page);
        const url = new URL(page.url());
        expect(url.searchParams.get("month")).toBe("1");
        expect(url.searchParams.get("indicator")).toBe(indicator);
        await expectSavedBreakdown(
          page,
          firstReport,
          indicator,
          testInfo,
          `${viewport.name}-${indicator}`,
        );
        await page
          .getByRole("button", { name: "ホームの報告へ戻る", exact: true })
          .click();
        await waitForPageLayout(page);
        await expect(source).toBeVisible();
        await expect(source).toBeFocused();
        expect(await savedState(page)).toEqual(monthOne);
      }

      await page
        .getByRole("button", { name: "国家ビューに戻る", exact: true })
        .click();
      const monthTwo = await advance(page, 2);
      expect(
        monthTwo.history.reports!.map((report) => report.monthIndex),
      ).toEqual([0, 1, 2]);
      expect(
        monthTwo.history.reports!.find((report) => report.monthIndex === 1),
      ).toEqual(firstReport);
      await page
        .getByRole("button", { name: "経済指標を見る", exact: true })
        .click();
      await page.getByRole("button", { name: "レポート", exact: true }).click();
      await reportDeck(page)
        .getByRole("combobox", { name: "経済レポートのカテゴリ" })
        .selectOption("causes");
      await selectReport(page, 1, "unemployment");
      await expectSavedBreakdown(
        page,
        firstReport,
        "unemployment",
        testInfo,
        `${viewport.name}-historical-unemployment`,
      );
      const historicalUrl = page.url();
      const monthInput = page.getByRole("combobox", {
        name: "報告の月",
        exact: true,
      });
      await reach(page, monthInput, reportDeck(page));
      await monthInput.selectOption("2");
      await waitForPageLayout(page);
      await expectTarget(page, 2, "unemployment");
      await page.goBack();
      await waitForPageLayout(page);
      expect(page.url()).toBe(historicalUrl);
      await expectTarget(page, 1, "unemployment");
      await page.reload();
      await waitForPageLayout(page);
      await expectTarget(page, 1, "unemployment");
      await expectSavedBreakdown(
        page,
        firstReport,
        "unemployment",
        testInfo,
        `${viewport.name}-reloaded-unemployment`,
      );
      expect(await savedState(page)).toEqual(monthTwo);
      expect(browserErrors).toEqual([]);

      await attachJson(testInfo, `${viewport.name}-ui-operation-log`, {
        method:
          "All starts, policy settings, expert choices, policy confirmation, monthly ticks and report navigation use normal UI controls. IndexedDB is read-only.",
        seed: SEED,
        setup: {
          scenario: "SCN-01",
          difficulty: "intro",
          months: 48,
          learning: "learning",
          publicWorks: "1%",
          timing: "immediate",
          experts: ["macro", "centralBank", "fiscal"],
        },
        months: [0, 1, 2],
        reports: monthTwo.history.reports,
        browserErrors,
      });
    });
  });
}
