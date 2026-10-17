import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";
import content from "../../packages/advisor-core/src/content-v1.2.0.json" with { type: "json" };
import { waitForPageLayout } from "./paging";

const LABEL = "開発用AIプレビュー";
const ENTRY = "開発用AIプレビューを開く";
const SEED = "playtest-first-20261014";
const VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
] as const;
const MAX_PAGES = 150;
const EXPERTS = [
  ["水城 静香", "中央銀行"],
  ["大蔵 堅", "財政"],
  ["景山 めぐみ", "マクロ経済"],
  ["工藤 拓", "産業政策"],
  ["働木 あゆみ", "雇用労働"],
  ["福原 守", "社会政策"],
  ["世代 千歳", "人口長期"],
  ["風間 光", "環境エネルギー"],
] as const;

test.setTimeout(180_000);

function preview(page: Page) {
  return page.getByRole("region", { name: LABEL, exact: true });
}

async function reveal(page: Page, target: Locator, region?: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const scope = region ?? page;
  const previous = scope.getByRole("button", { name: /の前のページ$/ });
  for (let step = 0; step < MAX_PAGES && (await previous.isEnabled()); step++) {
    await previous.click();
    await waitForPageLayout(page);
  }
  const next = scope.getByRole("button", { name: /の次のページ$/ });
  for (let step = 0; step < MAX_PAGES; step++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  await expect(target).toBeVisible();
}

async function dismissGuidance(page: Page) {
  const guidance = page.getByRole("dialog", { name: "運営の案内" });
  if (await guidance.isVisible())
    await guidance.getByRole("button", { name: "詳細を閉じる" }).click();
}

// Reproduce the reported entry route through real commands and persistence.
async function reachEconomyMenu(page: Page) {
  await page.goto("/");
  const seed = page.getByRole("textbox", { name: "再現用コード（任意）" });
  await reveal(page, seed);
  await seed.fill(SEED);
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  await dismissGuidance(page);
  await page.getByRole("button", { name: "政策を考える", exact: true }).click();
  const kind = page.getByRole("combobox", { name: "政策の種類", exact: true });
  await reveal(page, kind);
  await kind.selectOption("public-works");
  const size = page.getByRole("spinbutton", {
    name: "公共事業の追加規模（年間GDP比・%）",
  });
  await reveal(page, size);
  await size.fill("1");
  await page.getByRole("button", { name: "見通しを確認", exact: true }).click();
  await expect(page.getByRole("heading", { name: "政策の見通し" })).toBeVisible(
    { timeout: 60_000 },
  );
  const acknowledge = page.getByRole("checkbox", {
    name: "費用・副作用・警告を確認しました",
  });
  await reveal(page, acknowledge);
  await acknowledge.check();
  await page
    .getByRole("button", { name: "政策を確定する", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  await dismissGuidance(page);
  await page.getByRole("button", { name: "1か月進める", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "1か月進める", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
  await dismissGuidance(page);
  await page
    .getByRole("button", { name: "経済指標を見る", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "経済指標", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "画面メニュー", exact: true }),
  ).toBeVisible();
}

async function savedGame(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("macro-nation-games");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const request = database
          .transaction("slots")
          .objectStore("slots")
          .get(1);
        request.onsuccess = () =>
          resolve(JSON.stringify(request.result.current));
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

// A hidden scrollbar alone cannot establish that fieldsets and their labels fit.
async function expectFits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const problems: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth + 1)
          problems.push("document width");
        if (document.documentElement.scrollHeight > innerHeight + 1)
          problems.push("document height");
        const visible = (element: HTMLElement) =>
          !element.closest("[hidden], [inert]") &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden";
        for (const element of document.querySelectorAll<HTMLElement>(
          "[data-page-current], [data-page-item], fieldset, legend, label, button, select, input",
        )) {
          if (!visible(element)) continue;
          const bounds = element.getBoundingClientRect();
          const name =
            element.getAttribute("aria-label") ?? element.textContent?.trim();
          // Native text inputs scroll their value while their labeled control fits.
          if (
            !(element instanceof HTMLInputElement) &&
            element.scrollWidth > element.clientWidth + 2
          )
            problems.push(`${name}: clipped width`);
          if (
            !(element instanceof HTMLInputElement) &&
            element.scrollHeight > element.clientHeight + 2
          )
            problems.push(`${name}: clipped height`);
          if (
            bounds.left < -1 ||
            bounds.right > innerWidth + 1 ||
            bounds.top < -1 ||
            bounds.bottom > innerHeight + 1
          )
            problems.push(`${name}: outside viewport`);
          if (element.matches("button, select, input")) {
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
        const labels = Array.from(
          document.querySelectorAll<HTMLElement>(".expert-picker label"),
        ).filter(visible);
        for (const [index, label] of labels.entries()) {
          const bounds = label.getBoundingClientRect();
          for (const other of labels.slice(index + 1)) {
            const next = other.getBoundingClientRect();
            if (
              Math.min(bounds.right, next.right) -
                Math.max(bounds.left, next.left) >
                1 &&
              Math.min(bounds.bottom, next.bottom) -
                Math.max(bounds.top, next.top) >
                1
            )
              problems.push(`${label.textContent}: overlapping expert labels`);
          }
        }
        const navigation = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".page-controls, .page-actions",
          ),
        ).filter(visible);
        for (const element of Array.from(
          document.querySelectorAll<HTMLElement>(
            ".page-content [data-page-item], .page-content fieldset, .page-content label",
          ),
        ).filter(visible)) {
          const bounds = element.getBoundingClientRect();
          for (const controls of navigation) {
            const next = controls.getBoundingClientRect();
            if (
              Math.min(bounds.right, next.right) -
                Math.max(bounds.left, next.left) >
                1 &&
              Math.min(bounds.bottom, next.bottom) -
                Math.max(bounds.top, next.top) >
                1
            )
              problems.push(`${element.textContent}: overlaps page navigation`);
          }
        }
        return problems;
      }),
    )
    .toEqual([]);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`ai-preview-${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function readMenu(page: Page) {
  const menu = page.getByRole("region", { name: "画面メニュー", exact: true });
  const next = menu.getByRole("button", { name: "画面メニューの次のページ" });
  const previous = menu.getByRole("button", {
    name: "画面メニューの前のページ",
  });
  const pages: string[] = [];
  for (let index = 0; index < MAX_PAGES; index++) {
    await waitForPageLayout(page);
    await expectFits(page);
    pages.push(await menu.locator(".page-content").innerText());
    if (!(await next.isEnabled())) break;
    await next.click();
    if (index === MAX_PAGES - 1) throw new Error("Could not read the menu");
  }
  for (
    let index = 0;
    index < MAX_PAGES && (await previous.isEnabled());
    index++
  ) {
    await previous.click();
    await waitForPageLayout(page);
    await expectFits(page);
  }
  await expect(previous).toBeDisabled();
  return pages;
}

async function attachEvidence(
  page: Page,
  testInfo: TestInfo,
  evidence: object,
) {
  const path = testInfo.outputPath("ai-preview-evidence.json");
  await writeFile(
    path,
    JSON.stringify(
      {
        build:
          testInfo.project.name === "chromium-dev"
            ? "vite-development"
            : "production-preview",
        viewport: page.viewportSize(),
        url: page.url(),
        seed: SEED,
        ...evidence,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("ai-preview-evidence", {
    path,
    contentType: "application/json",
  });
}

async function selectCategory(page: Page, id: string) {
  const region = preview(page);
  await region
    .getByRole("combobox", { name: `${LABEL}のカテゴリ` })
    .selectOption(id);
  await waitForPageLayout(page);
  await expect(region.locator(".page-content")).toHaveAttribute(
    "data-page-category",
    id,
  );
  await expect(region.locator(".page-content")).toBeFocused();
}

async function readCategory(
  page: Page,
  id: string,
  visit?: (region: Locator) => Promise<void>,
) {
  await selectCategory(page, id);
  const region = preview(page);
  const select = region.getByRole("combobox", { name: `${LABEL}のカテゴリ` });
  const next = region.getByRole("button", { name: `${LABEL}の次のページ` });
  const pages: { status: string; text: string; labels: string[] }[] = [];
  for (let index = 0; index < MAX_PAGES; index++) {
    await waitForPageLayout(page);
    await expectFits(page);
    await visit?.(region);
    pages.push({
      status: await region
        .locator(".page-controls [role='status']")
        .innerText(),
      text: await region.locator(".page-content").innerText(),
      labels: await region.locator("label:visible").allTextContents(),
    });
    if (!(await next.isEnabled())) return pages;
    await next.click();
    await waitForPageLayout(page);
    await expect(region.locator(".page-content")).toBeFocused();
    if ((await select.inputValue()) !== id) return pages;
  }
  throw new Error(`Could not reach the end of ${id}`);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height} AI preview`, () => {
    test.use({ viewport });

    test("pages every category, keeps drafts and results, and returns focus", async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== "chromium-dev",
        "The preview exists only in the Vite development server",
      );
      const externalRequests: string[] = [];
      page.on("request", (request) => {
        if (
          !new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)
        )
          externalRequests.push(request.url());
      });
      await reachEconomyMenu(page);
      const before = await savedGame(page);
      const menuPages = await readMenu(page);
      await capture(page, testInfo, "development-menu");
      const entry = page.getByRole("button", { name: ENTRY, exact: true });
      await reveal(page, entry);
      await entry.click();
      await expect(preview(page)).toBeVisible();
      await expect(
        page.getByRole("region", { name: "画面メニュー", exact: true }),
      ).toHaveCount(0);
      await expect(preview(page).locator("[data-page-deck]")).toHaveCount(0);
      const categories = await preview(page)
        .getByRole("combobox", {
          name: `${LABEL}のカテゴリ`,
        })
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        );
      expect(categories).toEqual(
        expect.arrayContaining(["news", "advisors", "free-policy", "history"]),
      );
      const evidence: Record<string, unknown> = {
        categories,
        menuPages,
        path: "new game → public works 1% → confirm → next month → economy → menu → AI preview",
      };
      for (const id of categories) {
        evidence[`initial-${id}`] = await readCategory(page, id);
        await selectCategory(page, id);
        await capture(page, testInfo, `initial-${id}`);
      }

      const expertNames = EXPERTS.map(([name, role]) => `${name}（${role}）`);
      const selected = [expertNames[0]!, expertNames[3]!, expertNames[7]!];
      const reachedExperts = new Set<string>();
      await readCategory(page, "advisors", async (region) => {
        for (const name of expertNames) {
          const checkbox = region.getByRole("checkbox", { name, exact: true });
          if (!(await checkbox.isVisible())) continue;
          reachedExperts.add(name);
          if (selected.includes(name)) await checkbox.check();
          else if (await checkbox.isChecked()) await checkbox.uncheck();
        }
      });
      expect([...reachedExperts].sort()).toEqual([...expertNames].sort());

      await selectCategory(page, "free-policy");
      const idea = preview(page).getByRole("textbox", {
        name: "政策のアイデアを入力する",
      });
      await reveal(page, idea, preview(page));
      const draft = "政策金利を2%に。物価と雇用への影響を確認したい。";
      await idea.fill(draft);
      await selectCategory(page, "advisors");
      await readCategory(page, "advisors", async (region) => {
        for (const name of expertNames) {
          const checkbox = region.getByRole("checkbox", { name, exact: true });
          if (await checkbox.isVisible())
            await expect(checkbox).toBeChecked({
              checked: selected.includes(name),
            });
        }
      });
      const ask = preview(page).getByRole("button", {
        name: "専門家の意見を聞く",
        exact: true,
      });
      await reveal(page, ask, preview(page));
      await ask.click();
      const advice = await readCategory(page, "advisors");
      for (const index of [0, 3, 7])
        expect(advice.map((item) => item.text).join("")).toContain(
          EXPERTS[index]![0],
        );
      expect(advice.map((item) => item.text).join("")).toContain(
        content.ai.mockCaution,
      );
      expect(advice.length).toBeGreaterThan(1);
      evidence.generatedAdvice = advice;
      evidence.reachedExperts = [...reachedExperts];
      await selectCategory(page, "advisors");
      await capture(page, testInfo, "generated-advice");

      await selectCategory(page, "free-policy");
      await reveal(page, idea, preview(page));
      await expect(idea).toHaveValue(draft);
      const propose = preview(page).getByRole("button", {
        name: "政策案を作る",
        exact: true,
      });
      await reveal(page, propose, preview(page));
      await propose.click();
      const policy = await readCategory(page, "free-policy");
      expect(policy.map((item) => item.text).join("")).toContain(
        content.ai.policyInterpretation,
      );
      evidence.generatedPolicy = policy;
      await selectCategory(page, "free-policy");
      await capture(page, testInfo, "generated-policy");

      for (const [id, button, expected] of [
        ["news", "ニュースの理由を聞く", content.ai.newsEvidence],
        ["history", "国の歩みを文章にする", content.ai.historyTitle],
      ]) {
        await selectCategory(page, id!);
        const action = preview(page).getByRole("button", {
          name: button!,
          exact: true,
        });
        await reveal(page, action, preview(page));
        await action.click();
        const result = await readCategory(page, id!);
        expect(result.map((item) => item.text).join("")).toContain(expected);
        evidence[`generated-${id}`] = result;
        await selectCategory(page, id!);
        await capture(page, testInfo, `generated-${id}`);
      }
      await selectCategory(page, "free-policy");
      await reveal(page, idea, preview(page));
      await expect(idea).toHaveValue(draft);
      const retained = await readCategory(page, "advisors");
      expect(retained.map((item) => item.text).join("")).toEqual(
        advice.map((item) => item.text).join(""),
      );
      expect(await savedGame(page)).toEqual(before);
      expect(externalRequests).toEqual([]);

      const category = preview(page).getByRole("combobox", {
        name: `${LABEL}のカテゴリ`,
      });
      await selectCategory(page, "news");
      await category.focus();
      await page.keyboard.press("ArrowDown");
      await waitForPageLayout(page);
      await expect(category).toHaveValue("advisors");
      await expect(preview(page).locator(".page-content")).toBeFocused();
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(
            () => !!document.activeElement?.closest("[hidden], [inert]"),
          ),
        ).toBe(false);
      }
      await preview(page)
        .getByRole("button", { name: "画面メニューに戻る", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "画面メニュー", exact: true }),
      ).toBeVisible();
      await expect(entry).toBeFocused();
      await page.keyboard.press("Enter");
      await preview(page)
        .getByRole("button", { name: "閉じる", exact: true })
        .click();
      await expect(preview(page)).toHaveCount(0);
      const menu = page.getByRole("button", { name: "メニュー", exact: true });
      await expect(menu).toBeFocused();
      await menu.press("Enter");
      await reveal(page, entry);
      await entry.press("Enter");
      await expect(preview(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(preview(page)).toHaveCount(0);
      await expect(menu).toBeFocused();
      await expectFits(page);
      expect(await savedGame(page)).toEqual(before);
      await attachEvidence(page, testInfo, evidence);
    });
  });
}

test("production menu excludes the development AI preview", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "chromium-dev",
    "Production is covered by the normal preview-server suite",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  await dismissGuidance(page);
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  const menu = page.getByRole("region", { name: "画面メニュー", exact: true });
  await expect(menu).toBeVisible();
  await expect(
    page.getByRole("button", { name: ENTRY, exact: true, includeHidden: true }),
  ).toHaveCount(0);
  await expect(preview(page)).toHaveCount(0);
  const menuPages = await readMenu(page);
  expect(menuPages.join("")).not.toContain("開発用Mockプレビュー");
  await capture(page, testInfo, "production-menu");
  await menu.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "メニュー", exact: true }),
  ).toBeFocused();
  await expectFits(page);
  await attachEvidence(page, testInfo, {
    path: "new game → menu",
    menuPages,
    developmentEntryPresent: false,
  });
});
