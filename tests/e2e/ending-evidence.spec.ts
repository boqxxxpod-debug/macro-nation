import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { GameState } from "@macro-nation/domain";
import { waitForPageLayout } from "./paging";

const SEED = "playtest-scn01-4y-20261014";
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 360, height: 640 },
] as const;
const PERIOD = "期間全体の主な変化";
const FINAL = "最終月に大きく影響したこと";
const LABELS: Readonly<Record<string, string>> = {
  exports: "輸出",
  governmentDebt: "政府債務",
};

interface Progress {
  monthIndex: number;
  runState: GameState["runState"];
  pendingEvent?: string;
}
interface Inspection {
  state: GameState;
  progress: Progress;
  fingerprint: string;
}

/** Observe saves produced by real UI commands; never inject or edit game state. */
async function inspectSlot<K extends keyof Inspection>(
  page: Page,
  mode: K,
): Promise<Inspection[K]> {
  return page.evaluate(async (mode) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("macro-nation-games");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const record = await new Promise<{ current: GameState }>(
        (resolve, reject) => {
          const request = database
            .transaction("slots", "readonly")
            .objectStore("slots")
            .get(1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      const state = record.current;
      if (mode === "state") return state;
      if (mode === "progress")
        return {
          monthIndex: state.monthIndex,
          runState: state.runState,
          pendingEvent: state.events.pendingChoiceEventId,
        };
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(record)),
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    } finally {
      database.close();
    }
  }, mode) as Promise<Inspection[K]>;
}

function endingDeck(page: Page) {
  return page.getByRole("region", { name: "終了評価の詳細", exact: true });
}

function reportDeck(page: Page) {
  return page.getByRole("region", { name: "経済レポート", exact: true });
}

async function firstPage(page: Page, region: Locator) {
  await waitForPageLayout(page);
  const previous = region.getByRole("button", { name: /の前のページ$/ });
  const maximum = await region.locator("[data-page-item]").count();
  for (let step = 0; step < maximum && (await previous.isEnabled()); step++) {
    await previous.click();
    await waitForPageLayout(page);
  }
}

async function reach(page: Page, target: Locator, region?: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const deck = region ?? page.locator("[data-page-deck]:visible").first();
  await firstPage(page, deck);
  const next = deck.getByRole("button", { name: /の次のページ$/ });
  const maximum = await deck.locator("[data-page-item]").count();
  for (let step = 0; step < maximum; step++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
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

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function closeGuidance(page: Page) {
  const guidance = page.getByRole("dialog", { name: "運営の案内" });
  if (await guidance.isVisible())
    await guidance.getByRole("button", { name: "詳細を閉じる" }).click();
}

async function start(page: Page) {
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
  await expect(
    page.getByRole("heading", { name: "国家ビュー", exact: true }),
  ).toBeVisible();
  expect(await inspectSlot(page, "state")).toMatchObject({
    scenarioId: "SCN-01",
    difficulty: "intro",
    durationMode: "short",
    learningMode: "learning",
    monthIndex: 0,
    rng: { rootSeed: SEED },
    clock: { endMonth: 48, progressionMode: "manual" },
  });
}

async function confirmPolicy(
  page: Page,
  type: "publicWorks" | "interestRate",
  value: string,
  timing: "0" | "1",
  testInfo: TestInfo,
) {
  await page.getByRole("button", { name: "政策を考える", exact: true }).click();
  const kind = page.getByRole("combobox", { name: "政策の種類" });
  await reach(page, kind);
  await kind.selectOption({
    label: type === "publicWorks" ? "公共事業" : "政策金利",
  });
  const amount = page.getByRole("spinbutton", {
    name:
      type === "publicWorks"
        ? "公共事業の追加規模（年間GDP比・%）"
        : "政策金利（年率・%）",
  });
  await reach(page, amount);
  await amount.fill(value);
  const when = page.getByRole("combobox", { name: "政策を始める時期" });
  await reach(page, when);
  await when.selectOption(timing);
  await page.getByRole("button", { name: "見通しを確認", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "政策の見通し", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const acknowledge = page.getByRole("checkbox", {
    name: "費用・副作用・警告を確認しました",
  });
  await reach(page, acknowledge);
  await acknowledge.check();
  await screenshot(page, testInfo, `${type}-${value}-confirmation`);
  await page
    .getByRole("button", { name: "政策を確定する", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "国家ビュー", exact: true }),
  ).toBeVisible();
  await closeGuidance(page);
}

async function advanceTo(page: Page, target: number) {
  let progress = await inspectSlot(page, "progress");
  for (let step = 0; step < 150 && progress.monthIndex < target; step++) {
    if (progress.runState === "awaitingEvent") {
      await page
        .getByRole("button", { name: "イベントの対応を選ぶ", exact: true })
        .click();
      const choice = page.getByRole("button", {
        name: "バランスを取る",
        exact: true,
      });
      await reach(page, choice);
      await choice.click();
      await expect
        .poll(async () => (await inspectSlot(page, "progress")).pendingEvent)
        .not.toBe(progress.pendingEvent);
    } else if (progress.runState === "crisisStopped") {
      await page
        .getByRole("button", { name: "緊急会議を開く", exact: true })
        .click();
      const resume = page.getByRole("button", {
        name: "危機対応を確認して再開",
        exact: true,
      });
      await reach(page, resume);
      await resume.click();
      await expect
        .poll(async () => (await inspectSlot(page, "progress")).runState)
        .not.toBe("crisisStopped");
    } else {
      expect(progress.runState).not.toBe("failed");
      await page
        .getByRole("button", { name: "1か月進める", exact: true })
        .click();
      await expect
        .poll(async () => (await inspectSlot(page, "progress")).monthIndex)
        .toBe(progress.monthIndex + 1);
    }
    progress = await inspectSlot(page, "progress");
  }
  expect(progress.monthIndex).toBe(target);
}

async function resumeSlot(page: Page) {
  const slots = page.getByRole("button", { name: "保存スロット", exact: true });
  if (await slots.isVisible()) {
    await slots.click();
  } else {
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
    const start = page.getByRole("button", {
      name: "はじめる・続きから",
      exact: true,
    });
    await reach(page, start);
    await start.click();
  }
  const resume = page.getByRole("button", {
    name: "保存先1の続きから",
    exact: true,
  });
  await reach(page, resume);
  await resume.click();
  await expect(
    page.getByRole("heading", { name: "国家ビュー", exact: true }),
  ).toBeVisible();
}

/** PageDeck repeats headings across fragments; inspect each reachable page. */
async function collectEnding(page: Page, testInfo?: TestInfo) {
  const deck = endingDeck(page);
  await firstPage(page, deck);
  const texts = { period: [] as string[], final: [] as string[] };
  const next = deck.getByRole("button", {
    name: "終了評価の詳細の次のページ",
    exact: true,
  });
  const maximum = await deck.locator("[data-page-item]").count();
  for (let current = 0; current < maximum; current++) {
    await expectFits(page, deck);
    for (const [key, label] of [
      ["period", PERIOD],
      ["final", FINAL],
    ] as const) {
      const fragments = deck.locator(`section[aria-label="${label}"]:visible`);
      const visible = await fragments.allTextContents();
      const periods = await fragments.evaluateAll((sections) =>
        sections.map((section) => ({
          start: section.getAttribute("data-ending-period-start"),
          end: section.getAttribute("data-ending-period-end"),
          indicator: section.getAttribute("data-ending-indicator"),
        })),
      );
      expect(periods).toEqual(
        visible.map(() => ({
          start: key === "period" ? "0" : "47",
          end: "48",
          indicator: key === "period" ? "exports" : "governmentDebt",
        })),
      );
      texts[key].push(
        ...visible.map((text) => text.replace(/\s+/g, " ").trim()),
      );
      if (visible.length && testInfo)
        await screenshot(page, testInfo, `${key}-ending-page-${current + 1}`);
    }
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  expect(texts.period.length).toBeGreaterThan(0);
  expect(texts.final.length).toBeGreaterThan(0);
  return { period: texts.period.join("\n"), final: texts.final.join("\n") };
}

async function expectReportTarget(
  page: Page,
  month: number,
  indicator: string,
) {
  await waitForPageLayout(page);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/game/1/report");
  expect(url.searchParams.get("month")).toBe(String(month));
  expect(url.searchParams.get("indicator")).toBe(indicator);
  expect(url.searchParams.get("from")).toBe("ending");
  const deck = reportDeck(page);
  await expect(
    deck.getByRole("combobox", { name: "経済レポートのカテゴリ", exact: true }),
  ).toHaveValue("causes");
  const monthInput = deck.getByRole("combobox", {
    name: "報告の月",
    exact: true,
  });
  await reach(page, monthInput, deck);
  await expect(monthInput).toHaveValue(String(month));
  const indicatorInput = deck.getByRole("combobox", {
    name: "報告の指標",
    exact: true,
  });
  await reach(page, indicatorInput, deck);
  await expect(indicatorInput).toHaveValue(indicator);
  const heading = deck
    .getByRole("heading", {
      name: `${month}月目・${LABELS[indicator]}の変化の理由`,
      exact: true,
    })
    .first();
  await reach(page, heading, deck);
  await expect(heading).toBeVisible();
  await expectFits(page, deck);
  const causes = await deck.locator("[data-report-cause]").allTextContents();
  expect(causes.length).toBeGreaterThan(0);
  expect(causes.every((cause) => cause.includes(LABELS[indicator]!))).toBe(
    true,
  );
  await expect(
    page.getByRole("button", { name: "終了評価へ戻る", exact: true }),
  ).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ending evidence`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("a real 48-month run separates whole-period values and final-month causes across reports and resume", async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      await start(page);
      await confirmPolicy(page, "publicWorks", "1", "0", testInfo);
      await advanceTo(page, 4);
      await confirmPolicy(page, "interestRate", "2.5", "1", testInfo);
      await advanceTo(page, 9);
      const monthNine = await inspectSlot(page, "fingerprint");
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "国家ビュー", exact: true }),
      ).toBeVisible();
      expect(await inspectSlot(page, "fingerprint")).toBe(monthNine);
      await resumeSlot(page);
      expect(await inspectSlot(page, "fingerprint")).toBe(monthNine);
      await advanceTo(page, 36);
      await confirmPolicy(page, "interestRate", "5", "0", testInfo);
      await advanceTo(page, 48);
      await expect(
        page.getByRole("heading", { name: "終了評価", exact: true }),
      ).toBeVisible();

      const state = await inspectSlot(page, "state");
      expect(state.runState).toBe("completed");
      const fingerprint = await inspectSlot(page, "fingerprint");
      const initial = state.history.reports!.find(
        (report) => report.monthIndex === 0,
      )!;
      const final = state.history.reports!.find(
        (report) => report.monthIndex === 48,
      )!;
      const largest = Object.entries(final.values)
        .filter(
          ([id, value]) =>
            Number.isFinite(initial.values[id]) && Number.isFinite(value),
        )
        .sort(
          ([leftId, leftValue], [rightId, rightValue]) =>
            Math.abs(rightValue - initial.values[rightId]!) -
            Math.abs(leftValue - initial.values[leftId]!),
        )[0]!;
      expect(largest[0]).toBe("exports");
      expect(initial.values.exports).toBe(25);
      expect(final.values.exports).toBeGreaterThan(18);
      expect(final.values.exports).toBeLessThan(20);
      const finalCause = final.topCauses[0]!;
      expect(finalCause.indicatorId).toBe("governmentDebt");

      const text = await collectEnding(page, testInfo);
      expect(text.period).toContain(
        "対象期間：48か月全体（開始時点 → 48月目）",
      );
      expect(text.period).toContain("輸出");
      expect(text.period).toContain(
        `輸出：開始 ${initial.values.exports!.toFixed(1)} → 最終 ${final.values.exports!.toFixed(1)}`,
      );
      expect(text.period).toMatch(
        /期間全体.*(?:要因|理由).*(?:保存|記録).*(?:いません|ありません|ない)/,
      );
      expect(text.period).not.toContain("政府債務");
      expect(text.period).not.toContain("前月から続く経済の動き");
      expect(text.final).toContain("47月目 → 48月目");
      expect(text.final).toContain("政府債務");
      expect(text.final).toContain("前月から続く経済の動き");
      expect(text.final).toContain(String(Number(finalCause.delta.toFixed(6))));
      expect(text.final).not.toContain("48か月全体");
      await expect(
        endingDeck(page).getByRole("button", {
          name: "変化の理由を見る",
          exact: true,
        }),
      ).toBeVisible();

      for (const [name, indicator] of [
        ["輸出の月次記録を見る（48月目）", "exports"],
        ["最終月の要因をレポートで見る", finalCause.indicatorId],
      ] as const) {
        const source = endingDeck(page).getByRole("button", {
          name,
          exact: true,
        });
        await reach(page, source, endingDeck(page));
        await expectFits(page, endingDeck(page));
        await source.click();
        await expectReportTarget(page, 48, indicator);
        await screenshot(page, testInfo, `${indicator}-report`);
        const targetUrl = page.url();
        await page.reload();
        expect(page.url()).toBe(targetUrl);
        await expectReportTarget(page, 48, indicator);
        await page
          .getByRole("button", { name: "終了評価へ戻る", exact: true })
          .click();
        await expect(page).toHaveURL(/\/game\/1\/ending$/);
        await page.goBack();
        expect(page.url()).toBe(targetUrl);
        await expectReportTarget(page, 48, indicator);
        await page
          .getByRole("button", { name: "終了評価へ戻る", exact: true })
          .click();
        await expect(page).toHaveURL(/\/game\/1\/ending$/);
        expect(await collectEnding(page)).toEqual(text);
        expect(await inspectSlot(page, "fingerprint")).toBe(fingerprint);
      }

      await page.reload();
      await expect(
        page.getByRole("heading", { name: "終了評価", exact: true }),
      ).toBeVisible();
      expect(await collectEnding(page)).toEqual(text);
      expect(await inspectSlot(page, "fingerprint")).toBe(fingerprint);
      await resumeSlot(page);
      await page
        .getByRole("button", { name: "終了評価を見る", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "終了評価", exact: true }),
      ).toBeVisible();
      expect(await collectEnding(page)).toEqual(text);
      expect(await inspectSlot(page, "fingerprint")).toBe(fingerprint);
      expect(browserErrors).toEqual([]);
      await testInfo.attach("real-ui-operation-evidence", {
        body: JSON.stringify(
          {
            method: "Normal UI only; IndexedDB inspection is read-only.",
            seed: SEED,
            viewport,
            commands: [
              { month: 0, type: "publicWorks", value: 1, timing: "immediate" },
              {
                month: 4,
                type: "interestRate",
                value: 2.5,
                timing: "oneQuarterAhead",
              },
              {
                month: 36,
                type: "interestRate",
                value: 5,
                timing: "immediate",
              },
            ],
            reloadAndResumeMonth: 9,
            completedMonth: 48,
            initialExport: initial.values.exports,
            finalExport: final.values.exports,
            finalCause,
            endingText: text,
            fingerprint,
            browserErrors,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    });
  });
}
