import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForPageLayout } from "./paging";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 640 },
  { name: "desktop", width: 1366, height: 768 },
] as const;
const MAX_PAGE_STEPS = 200;
const COMPARISON_HEADING = "新しい政策を加えない場合との12か月比較";
const REVIEW_LABEL = "費用・副作用・警告を確認しました";
const METRICS = ["実質GDP", "物価上昇率", "失業率"] as const;

test.setTimeout(120_000);

function previewDeck(page: Page) {
  return page.getByRole("region", { name: "政策の見通し", exact: true });
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

async function openPreview(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await page.getByRole("button", { name: "政策会議", exact: true }).click();
  await setRateAndPreview(page, "5");
}

async function setRateAndPreview(page: Page, rate: string) {
  const input = page.getByRole("spinbutton", { name: "政策金利（年率・%）" });
  await reveal(page, input);
  await input.fill(rate);
  await page.getByRole("button", { name: "見通しを確認" }).click();
  await expect(
    page.getByRole("heading", { name: "政策の見通し" }),
  ).toBeVisible();
  await waitForPageLayout(page);
  await expect(
    previewDeck(page).locator("[data-page-current]"),
  ).toHaveAttribute("data-page-current", "1");
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
          '[data-page-deck][aria-label="政策の見通し"] [data-page-current], ' +
            '[data-page-deck][aria-label="政策の見通し"] [data-page-item], ' +
            '[data-page-deck][aria-label="政策の見通し"] button',
        )) {
          if (
            element.closest("[hidden], [inert]") ||
            getComputedStyle(element).visibility === "hidden" ||
            !element.getClientRects().length
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

async function readToAcknowledgement(page: Page, rate: string) {
  const deck = previewDeck(page);
  const checkbox = deck.getByRole("checkbox", { name: REVIEW_LABEL });
  const next = deck.getByRole("button", { name: "政策の見通しの次のページ" });
  const summary: string[] = [];
  for (let step = 0; step < MAX_PAGE_STEPS; step++) {
    await waitForPageLayout(page);
    await expectViewport(page);
    await expect(
      deck.getByRole("button", { name: "案を修正する" }),
    ).toBeVisible();
    await expect(
      deck.getByRole("button", { name: "政策を確定する" }),
    ).toBeDisabled();
    await expect(
      deck.getByRole("heading", { name: "選択した専門家の解説" }),
    ).toHaveCount(0);
    summary.push(
      ...(await deck
        .locator(
          '[data-page-item]:not([hidden]) section[aria-label="判断の要点"] p',
        )
        .allTextContents()),
    );
    if (await checkbox.isVisible()) {
      await expect(checkbox).not.toBeChecked();
      expect(
        await checkbox.evaluate((input) =>
          Array.from(
            input
              .closest("[data-page-deck]")!
              .querySelectorAll('section[aria-label="判断の要点"] p'),
          ).every(
            (paragraph) =>
              !!(
                paragraph.compareDocumentPosition(input) &
                Node.DOCUMENT_POSITION_FOLLOWING
              ),
          ),
        ),
        "Every summary paragraph must precede the acknowledgement, including on the same page",
      ).toBe(true);
      const text = summary.join("").replace(/\s+/g, "");
      for (const category of [
        "政策案：",
        "時期：",
        "現状維持との差（1年後）：",
        "費用：",
        "副作用：",
        "不確実性：",
      ])
        expect(text).toContain(category);
      expect(text).toContain(`政策金利（年率・%）：${rate}%`);
      expect(text).toMatch(/政策の開始は\d+月目、主効果の効き始めは\d+月目/);
      expect(text).toMatch(/いちばん大きい時期は\d+か月後/);
      expect(text).toContain("新しい政策を加えない場合と比べた中心値");
      for (const cost of ["政治資本", "実施能力", "外貨準備", "開始予算"])
        expect(text).toMatch(new RegExp(`${cost}\\d+(?:\\.\\d+)?`));
      expect(text).toMatch(/副作用：.+（\d+月目から）/);
      expect(text).toMatch(/不確実性：確信度[高中低]。主な要因は.+。/);
      expect(text).toContain("この範囲に収まる確率を示すものではありません");
      const deltas = Object.fromEntries(
        METRICS.map((metric) => {
          const match = text.match(new RegExp(`${metric}([+-]?\\d+\\.\\d+%?)`));
          expect(
            match,
            `${metric} must include its one-year policy difference`,
          ).not.toBeNull();
          return [metric, match![1]];
        }),
      );
      return { checkbox, deltas };
    }
    await expect(
      next,
      "All judgment material must precede confirmation",
    ).toBeEnabled();
    await next.click();
  }
  throw new Error("Could not reach the policy acknowledgement");
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} policy preview`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("reads judgment material before confirmation and retains detailed comparisons", async ({
      page,
    }, testInfo) => {
      await openPreview(page);
      const summaryScreenshot = testInfo.outputPath("judgment-summary.png");
      await page.screenshot({ path: summaryScreenshot, fullPage: true });
      await testInfo.attach("judgment-summary", {
        path: summaryScreenshot,
        contentType: "image/png",
      });
      const { checkbox, deltas } = await readToAcknowledgement(page, "5");
      const deck = previewDeck(page);
      await checkbox.check();
      await waitForPageLayout(page);
      await expect(
        deck.getByRole("button", { name: "政策を確定する" }),
      ).toBeEnabled();
      await expectViewport(page);
      const confirmationScreenshot = testInfo.outputPath(
        "judgment-confirmation.png",
      );
      await page.screenshot({ path: confirmationScreenshot, fullPage: true });
      await testInfo.attach("judgment-confirmation", {
        path: confirmationScreenshot,
        contentType: "image/png",
      });

      // Checking the box changes the footer height. Return to the beginning so
      // repagination cannot cause the traversal to skip a detail paragraph.
      await rewind(page);
      const next = deck.getByRole("button", {
        name: "政策の見通しの次のページ",
      });
      const text: string[] = [];
      const comparisons: Record<string, string> = {};
      let reachedEnd = false;
      for (let step = 0; step < MAX_PAGE_STEPS; step++) {
        await waitForPageLayout(page);
        await expectViewport(page);
        await expect(
          deck.getByRole("button", { name: "案を修正する" }),
        ).toBeVisible();
        await expect(
          deck.getByRole("button", { name: "政策を確定する" }),
        ).toBeEnabled();
        const items = deck.locator("[data-page-item]:not([hidden])");
        text.push(...(await items.allTextContents()));
        const rows = await items.evaluateAll(
          (visibleItems, heading) =>
            visibleItems.flatMap((item) =>
              item.querySelector("h3")?.textContent === heading
                ? Array.from(item.querySelectorAll("article")).map(
                    (article) => ({
                      metric: article.querySelector("h4")?.textContent ?? "",
                      text: Array.from(article.querySelectorAll("p"))
                        .map((paragraph) => paragraph.textContent)
                        .join(""),
                    }),
                  )
                : [],
            ),
          COMPARISON_HEADING,
        );
        for (const row of rows)
          comparisons[row.metric] = (comparisons[row.metric] ?? "") + row.text;
        if (!(await next.isEnabled())) {
          reachedEnd = true;
          break;
        }
        await next.click();
      }
      expect(reachedEnd).toBe(true);
      const details = text.join("\n");
      for (const heading of [
        COMPARISON_HEADING,
        "1年・5年の見通し",
        "別の政策を選んだら",
        "選択した専門家の解説",
      ])
        expect(details).toContain(heading);
      for (const content of [
        "3か月：",
        "6か月：",
        "12か月：",
        "1年後",
        "5年後",
        "今の政策を続ける",
        "結論：",
        "やさしい理由：",
        "注意点：",
      ])
        expect(details).toContain(content);
      for (const metric of METRICS) {
        const comparison = comparisons[metric]?.replace(/\s+/g, "");
        expect(comparison).toContain(
          `新しい政策を加えない場合との差${deltas[metric]}`,
        );
      }
    });

    test("resets confirmation after editing and can commit before expert explanations", async ({
      page,
    }) => {
      await openPreview(page);
      const initial = await readToAcknowledgement(page, "5");
      await initial.checkbox.check();
      await expect(
        page.getByRole("button", { name: "政策を確定する" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "案を修正する" }).click();
      await setRateAndPreview(page, "6");
      const revised = await readToAcknowledgement(page, "6");
      await revised.checkbox.check();
      await waitForPageLayout(page);
      await expectViewport(page);
      await expect(
        previewDeck(page).getByRole("heading", {
          name: "選択した専門家の解説",
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "政策を確定する" }).click();
      await expect(
        page.getByText("政策を確定し、端末に保存しました。"),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "国家ホーム" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "政策会議", exact: true }).click();
      await expect(page.getByText(/残り 2 \/ 3枠/)).toBeVisible();
    });
  });
}
