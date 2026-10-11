import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForPageLayout } from "./paging";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 640, hasTouch: true },
  { name: "desktop", width: 1366, height: 768, hasTouch: false },
] as const;
const HOME_TERMS = [
  "家計の実質所得",
  "実質GDP",
  "物価上昇率",
  "失業率",
  "政策への信頼",
] as const;
const COST_TERMS = ["政治資本", "実施能力", "外貨準備"] as const;
const MAX_PAGE_STEPS = 200;

test.setTimeout(120_000);

function helpTrigger(page: Page, term: string) {
  return page.getByRole("button", { name: `${term}の説明`, exact: true });
}

function helpDialog(page: Page, term: string) {
  return page.getByRole("dialog", { name: term, exact: true });
}

async function activate(trigger: Locator, hasTouch: boolean) {
  if (hasTouch) await trigger.tap();
  else await trigger.click();
}

async function reveal(page: Page, target: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const previous = page.getByRole("button", { name: /の前のページ$/ });
  for (let step = 0; step < MAX_PAGE_STEPS; step++) {
    if (!(await previous.isEnabled())) break;
    await previous.click();
    await waitForPageLayout(page);
  }
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
          'button[aria-label$="の説明"], .home-indicator > strong, .home-indicator > small, [popover]:popover-open, [popover]:popover-open button',
        )) {
          if (
            element.closest("[hidden], [inert]") ||
            !element.getClientRects().length
          )
            continue;
          const bounds = element.getBoundingClientRect();
          const name =
            element.getAttribute("aria-label") ?? element.textContent;
          if (
            bounds.left < -1 ||
            bounds.right > innerWidth + 1 ||
            bounds.top < -1 ||
            bounds.bottom > innerHeight + 1
          )
            problems.push(`${name}: outside viewport`);
          if (
            element instanceof HTMLButtonElement &&
            (bounds.width < 43.5 || bounds.height < 43.5)
          )
            problems.push(`${name}: tap target`);
          if (element.matches(":popover-open")) {
            if (element.scrollWidth > element.clientWidth + 2)
              problems.push(`${name}: content width`);
            if (element.scrollHeight > element.clientHeight + 2)
              problems.push(`${name}: content height`);
          }
        }
        return problems;
      }),
    )
    .toEqual([]);
}

async function expectHelpOpen(page: Page, term: string) {
  const dialog = helpDialog(page, term);
  await expect(dialog).toBeVisible();
  await expect(page.locator("[popover]:popover-open")).toHaveCount(1);
  await expect(dialog.locator("p")).toHaveText(/.+。$/);
  await expect(
    dialog.getByRole("button", { name: "閉じる", exact: true }),
  ).toBeVisible();
  await expectViewport(page);
  return dialog;
}

async function expectHomeValues(page: Page, values: string[]) {
  const overview = page.getByRole("region", {
    name: "主要5指標・前月比",
    exact: true,
  });
  const displayed = overview.locator("article > strong");
  await expect(displayed).toHaveText(values);
  for (const value of await displayed.all()) await expect(value).toBeVisible();
  for (const term of HOME_TERMS)
    await expect(helpTrigger(page, term)).toBeVisible();
  await expectViewport(page);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} term help`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.hasTouch,
    });

    test("home terms support pointer, keyboard and dismissal without changing the indicators", async ({
      page,
    }, testInfo) => {
      await page.goto("/");
      await page.getByRole("button", { name: "はじめる", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "国家ホーム" }),
      ).toBeVisible();
      await waitForPageLayout(page);
      const values = await page
        .getByRole("region", { name: "主要5指標・前月比", exact: true })
        .locator("article > strong")
        .allTextContents();
      expect(values).toHaveLength(5);
      await expectHomeValues(page, values);

      for (const term of HOME_TERMS) {
        const trigger = helpTrigger(page, term);
        await activate(trigger, viewport.hasTouch);
        const dialog = await expectHelpOpen(page, term);
        if (term === "実質GDP") {
          const screenshot = testInfo.outputPath("home-term-help.png");
          await page.screenshot({ path: screenshot });
          await testInfo.attach("home-term-help", {
            path: screenshot,
            contentType: "image/png",
          });
        }
        await activate(
          dialog.getByRole("button", { name: "閉じる", exact: true }),
          viewport.hasTouch,
        );
        await expect(page.locator("[popover]:popover-open")).toHaveCount(0);
        await expectHomeValues(page, values);
      }

      const gdp = helpTrigger(page, "実質GDP");
      for (const key of ["Enter", "Space"]) {
        await gdp.focus();
        await page.keyboard.press(key);
        await expectHelpOpen(page, "実質GDP");
        await page.keyboard.press("Escape");
        await expect(page.locator("[popover]:popover-open")).toHaveCount(0);
        await expect(gdp).toBeFocused();
        await expectHomeValues(page, values);
      }

      await gdp.focus();
      await page.keyboard.press("Enter");
      const keyboardDialog = await expectHelpOpen(page, "実質GDP");
      await page.keyboard.press("Tab");
      await expect(
        keyboardDialog.getByRole("button", { name: "閉じる", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("[popover]:popover-open")).toHaveCount(0);
      await expect(gdp).toBeFocused();
      await expectHomeValues(page, values);

      await activate(gdp, viewport.hasTouch);
      await expectHelpOpen(page, "実質GDP");
      const inflation = helpTrigger(page, "物価上昇率");
      await inflation.focus();
      await page.keyboard.press("Enter");
      await expectHelpOpen(page, "物価上昇率");
      await expect(helpDialog(page, "実質GDP")).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(inflation).toBeFocused();
      await expectHomeValues(page, values);

      await activate(gdp, viewport.hasTouch);
      const dialog = await expectHelpOpen(page, "実質GDP");
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x > 2 || bounds!.y > 2).toBe(true);
      if (viewport.hasTouch) await page.touchscreen.tap(2, 2);
      else await page.mouse.click(2, 2);
      await expect(page.locator("[popover]:popover-open")).toHaveCount(0);
      await expectHomeValues(page, values);
    });

    test("policy costs retain visible values while their paginated help opens and closes", async ({
      page,
    }, testInfo) => {
      await page.goto("/");
      await page.getByRole("button", { name: "はじめる", exact: true }).click();
      await page.getByRole("button", { name: "政策会議", exact: true }).click();
      const rate = page.getByRole("spinbutton", {
        name: "政策金利（年率・%）",
      });
      await reveal(page, rate);
      await rate.fill("5");
      await page.getByRole("button", { name: "見通しを確認" }).click();
      await expect(
        page.getByRole("heading", { name: "政策の見通し" }),
      ).toBeVisible();
      await waitForPageLayout(page);

      for (const term of COST_TERMS) {
        const trigger = helpTrigger(page, term);
        await reveal(page, trigger);
        await expect(
          trigger.locator('xpath=ancestor::section[@aria-label="判断の要点"]'),
        ).toBeVisible();
        const cost = trigger.locator("xpath=ancestor::p[1]");
        const before = await cost.innerText();
        expect(before).toMatch(/\d/);
        await activate(trigger, viewport.hasTouch);
        const dialog = await expectHelpOpen(page, term);
        if (term === "外貨準備") {
          const screenshot = testInfo.outputPath("policy-cost-help.png");
          await page.screenshot({ path: screenshot });
          await testInfo.attach("policy-cost-help", {
            path: screenshot,
            contentType: "image/png",
          });
        }
        await activate(
          dialog.getByRole("button", { name: "閉じる", exact: true }),
          viewport.hasTouch,
        );
        await expect(page.locator("[popover]:popover-open")).toHaveCount(0);
        await expect(cost).toBeVisible();
        await expect(cost).toHaveText(before);
        await expectViewport(page);
      }
    });
  });
}
