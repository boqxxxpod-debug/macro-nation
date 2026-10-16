import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForPageLayout } from "./paging";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 360, height: 640 },
] as const;
const RESOURCES = ["政治資本", "実施能力", "外貨準備", "開始予算"] as const;
const RESOURCE_TERMS = [
  "現在量",
  "予約済み",
  "使える量",
  "この案の基本費用",
  "採用後に使える残量",
];
const INITIAL = [60, 65, 300, 50];
const COSTS = [5, 10, 0, 10];
const MAX_PAGE_STEPS = 250;

test.setTimeout(180_000);

function resourceCard(page: Page, name: string) {
  return page.getByRole("article", {
    name: `${name}の費用と残量`,
    exact: true,
  });
}

async function rewind(page: Page) {
  const previous = page.getByRole("button", { name: /の前のページ$/ });
  for (let step = 0; step < MAX_PAGE_STEPS; step++) {
    await waitForPageLayout(page);
    if (!(await previous.isEnabled())) return;
    await previous.click();
  }
  throw new Error("Could not return to the first page");
}

async function reveal(page: Page, target: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  await rewind(page);
  const next = page.getByRole("button", { name: /の次のページ$/ });
  for (let step = 0; step < MAX_PAGE_STEPS; step++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  await expect(target).toBeVisible();
}

async function expectViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const problems: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth + 1)
          problems.push("document width");
        if (document.documentElement.scrollHeight > innerHeight + 1)
          problems.push("document height");
        for (const element of document.querySelectorAll<HTMLElement>(
          "[data-page-current], [data-page-item], " +
            '[aria-label$="の費用と残量"], .page-actions button, ' +
            ".page-controls button, [popover]:popover-open, [popover]:popover-open button",
        )) {
          if (
            element.closest("[hidden], [inert]") ||
            !element.getClientRects().length ||
            getComputedStyle(element).visibility === "hidden"
          )
            continue;
          const bounds = element.getBoundingClientRect();
          const name =
            element.getAttribute("aria-label") ?? element.textContent;
          if (element.scrollWidth > element.clientWidth + 2)
            problems.push(`${name}: content width`);
          if (element.scrollHeight > element.clientHeight + 2)
            problems.push(`${name}: content height`);
          if (
            bounds.left < -1 ||
            bounds.right > innerWidth + 1 ||
            bounds.top < -1 ||
            bounds.bottom > innerHeight + 1
          )
            problems.push(`${name}: outside viewport`);
          if (element instanceof HTMLButtonElement) {
            if (bounds.width < 43.5 || bounds.height < 43.5)
              problems.push(`${name}: tap target`);
            if (
              !document.querySelector("[popover]:popover-open") ||
              element.closest("[popover]:popover-open")
            ) {
              const hit = document.elementFromPoint(
                bounds.left + bounds.width / 2,
                bounds.top + bounds.height / 2,
              );
              if (hit !== element && !element.contains(hit))
                problems.push(`${name}: covered`);
            }
          }
        }
        return problems;
      }),
    )
    .toEqual([]);
}

async function readResources(
  page: Page,
  current: readonly number[] | null,
  reserved: readonly number[],
  help = false,
) {
  const values: number[][] = [];
  for (const [index, name] of RESOURCES.entries()) {
    const card = resourceCard(page, name);
    await reveal(page, card);
    await expect(card.locator("dt")).toHaveText(RESOURCE_TERMS);
    const definitions = card.locator("dd");
    const text = await definitions.allTextContents();
    const numbers = text.map((value) =>
      Number(value.match(/-?\d+(?:\.\d+)?/)?.[0]),
    );
    expect(numbers.every(Number.isFinite)).toBe(true);
    expect(numbers).toHaveLength(5);
    if (current) expect(numbers[0]).toBe(current[index]);
    expect(numbers[1]).toBe(reserved[index]);
    expect(numbers[2]).toBeCloseTo(numbers[0]! - numbers[1]!, 1);
    expect(numbers[3]).toBe(COSTS[index]);
    expect(numbers[4]).toBeCloseTo(numbers[2]! - numbers[3]!, 1);
    await expectViewport(page);
    if (help && index < 3) {
      await card
        .getByRole("button", { name: `${name}の説明`, exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name, exact: true });
      await expect(dialog).toBeVisible();
      await expectViewport(page);
      await expect(definitions).toHaveText(text);
      await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(card).toBeVisible();
      await expect(definitions).toHaveText(text);
    }
    values.push(numbers);
  }
  const scale = page.getByText(/^政治資本・実施能力は0〜100点/).first();
  await reveal(page, scale);
  await expect(scale).toContainText("model unit");
  return values;
}

async function startScenario(page: Page) {
  await page.goto("/");
  for (const [name, value] of [
    ["シナリオ", "SCN-01"],
    ["難易度", "intro"],
    ["説明モード", "learning"],
  ]) {
    const input = page.getByRole("combobox", { name, exact: true });
    await reveal(page, input);
    await input.selectOption(value!);
  }
  const duration = page.getByRole("radio", { name: /4年（48か月）/ });
  await reveal(page, duration);
  await duration.check();
  const seed = page.getByRole("textbox", { name: "再現用コード（任意）" });
  await reveal(page, seed);
  await seed.fill("playtest-scn01-4y-20261014");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
}

async function setPublicWorks(page: Page, quartersAhead = "0") {
  const kind = page.getByRole("combobox", { name: "政策の種類", exact: true });
  await reveal(page, kind);
  await kind.selectOption("public-works");
  const value = page.getByRole("spinbutton", {
    name: "公共事業の追加規模（年間GDP比・%）",
  });
  await reveal(page, value);
  await value.fill("1");
  const start = page.getByRole("combobox", {
    name: "政策を始める時期",
    exact: true,
  });
  await reveal(page, start);
  await start.selectOption(quartersAhead);
}

async function openPreview(page: Page) {
  await page.getByRole("button", { name: "見通しを確認", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "政策の見通し", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await waitForPageLayout(page);
}

async function readEveryPreviewPage(page: Page) {
  await rewind(page);
  const deck = page.getByRole("region", { name: "政策の見通し", exact: true });
  const next = deck.getByRole("button", { name: "政策の見通しの次のページ" });
  const comparisons = new Set<string>();
  const forecasts = new Set<string>();
  const alternatives = new Set<string>();
  let reachedEnd = false;
  for (let step = 0; step < MAX_PAGE_STEPS; step++) {
    await waitForPageLayout(page);
    await expectViewport(page);
    await expect(
      deck.getByRole("button", { name: "案を修正する" }),
    ).toBeVisible();
    await expect(
      deck.getByRole("button", { name: "政策を確定する" }),
    ).toBeVisible();
    await expect(
      deck.getByRole("button", { name: "政策を確定する" }),
    ).toBeDisabled();
    const visible = deck.locator("[data-page-item]:not([hidden])");
    for (const heading of await visible
      .locator(".comparison-list article h4")
      .allTextContents())
      comparisons.add(heading);
    for (const heading of await visible
      .locator(".forecast-grid article h4")
      .allTextContents())
      forecasts.add(heading);
    for (const heading of await visible
      .locator(".counterfactual-cards article h4")
      .allTextContents())
      alternatives.add(heading);
    if (!(await next.isEnabled())) {
      reachedEnd = true;
      break;
    }
    await next.click();
  }
  expect(reachedEnd).toBe(true);
  expect([...comparisons].sort()).toEqual(
    ["実質GDP", "物価上昇率", "失業率", "政策への信頼", "外貨準備"].sort(),
  );
  expect([...forecasts].sort()).toEqual(
    ["実質GDP", "物価上昇率", "失業率"].sort(),
  );
  expect([...alternatives].sort()).toEqual(
    ["公共事業", "今の政策を続ける", "政策金利"].sort(),
  );
  const acknowledgement = deck.getByRole("checkbox", {
    name: "費用・副作用・警告を確認しました",
  });
  await reveal(page, acknowledgement);
  await expect(acknowledgement).not.toBeChecked();
  await acknowledgement.check();
  await expect(
    deck.getByRole("button", { name: "政策を確定する" }),
  ).toBeEnabled();
  await waitForPageLayout(page);
  await expectViewport(page);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} policy resources`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("shows current resources beside costs and releases a UI-created reservation on activation", async ({
      page,
    }, testInfo) => {
      await startScenario(page);
      await page
        .getByRole("button", { name: "政策を考える", exact: true })
        .click();
      await setPublicWorks(page);
      const meeting = await readResources(page, INITIAL, [0, 0, 0, 0]);
      await openPreview(page);
      expect(await readResources(page, INITIAL, [0, 0, 0, 0], true)).toEqual(
        meeting,
      );
      await reveal(page, resourceCard(page, "政治資本"));
      const resourceScreenshot = testInfo.outputPath("resources-and-costs.png");
      await page.screenshot({ path: resourceScreenshot });
      await testInfo.attach("resources-and-costs", {
        path: resourceScreenshot,
        contentType: "image/png",
      });
      await readEveryPreviewPage(page);

      await page
        .getByRole("button", { name: "案を修正する", exact: true })
        .click();
      const value = page.getByRole("spinbutton", {
        name: "公共事業の追加規模（年間GDP比・%）",
      });
      await reveal(page, value);
      await expect(value).toHaveValue("1");
      await setPublicWorks(page, "1");
      expect(await readResources(page, INITIAL, [0, 0, 0, 0])).toEqual(meeting);
      await openPreview(page);
      const acknowledge = page.getByRole("checkbox", {
        name: "費用・副作用・警告を確認しました",
      });
      await reveal(page, acknowledge);
      await expect(acknowledge).not.toBeChecked();
      await acknowledge.check();
      await page
        .getByRole("button", { name: "政策を確定する", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "国家ビュー" }),
      ).toBeVisible();
      const guidance = page.getByRole("dialog", { name: "運営の案内" });
      if (await guidance.isVisible())
        await guidance.getByRole("button", { name: "詳細を閉じる" }).click();
      await page
        .getByRole("button", { name: "政策を考える", exact: true })
        .click();
      await setPublicWorks(page);
      await readResources(page, INITIAL, COSTS);

      await page
        .getByRole("button", { name: "国家ビューに戻る", exact: true })
        .click();
      if (await guidance.isVisible())
        await guidance.getByRole("button", { name: "詳細を閉じる" }).click();
      for (let month = 0; month < 4; month++) {
        await page
          .getByRole("button", { name: "1か月進める", exact: true })
          .click();
        await expect(
          page
            .getByRole("region", { name: "時間の進行", exact: true })
            .locator("strong"),
        ).toHaveText(`1年目 ${month + 2}月`);
        await expect(
          page.getByRole("button", { name: "1か月進める", exact: true }),
        ).toBeEnabled();
        if (await guidance.isVisible())
          await guidance.getByRole("button", { name: "詳細を閉じる" }).click();
      }
      await page
        .getByRole("button", { name: "政策を考える", exact: true })
        .click();
      await setPublicWorks(page);
      await readResources(page, null, [0, 0, 0, 0]);
      await reveal(page, resourceCard(page, "政治資本"));
      const activatedScreenshot = testInfo.outputPath(
        "resources-after-activation.png",
      );
      await page.screenshot({ path: activatedScreenshot });
      await testInfo.attach("resources-after-activation", {
        path: activatedScreenshot,
        contentType: "image/png",
      });
    });
  });
}
