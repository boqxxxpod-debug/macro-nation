import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { GameState } from "@macro-nation/domain";
import { writeFile } from "node:fs/promises";
import copy from "../../apps/web/src/ui/game-guide-copy.json" with { type: "json" };
import { waitForPageLayout } from "./paging";

const VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 375, height: 812 },
] as const;
const ROUTES = [
  ["nation", "国家ビュー"],
  ["policies", "政策会議"],
  ["home", "経済指標"],
  ["report", "レポート"],
] as const;
const SEED = "playtest-visual-20261014";

test.setTimeout(120_000);

async function attachEvidence(
  testInfo: TestInfo,
  name: string,
  body: Buffer | string,
  extension: "png" | "json",
) {
  const path = testInfo.outputPath(`${name}.${extension}`);
  await writeFile(path, body);
  await testInfo.attach(name, {
    path,
    contentType: extension === "png" ? "image/png" : "application/json",
  });
}

async function reveal(page: Page, target: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const previous = page.getByRole("button", { name: /の前のページ$/ });
  for (let step = 0; step < 100 && (await previous.isEnabled()); step++) {
    await previous.click();
    await waitForPageLayout(page);
  }
  const next = page.getByRole("button", { name: /の次のページ$/ });
  for (let step = 0; step < 100; step++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  await expect(target).toBeVisible();
}

async function activate(control: Locator, keyboard = false) {
  await expect(control).toBeVisible();
  expect(
    await control.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return (
        bounds.left >= 0 &&
        bounds.right <= innerWidth + 1 &&
        bounds.top >= 0 &&
        bounds.bottom <= innerHeight + 1 &&
        bounds.width >= 44 &&
        bounds.height >= 44 &&
        (hit === element || element.contains(hit))
      );
    }),
  ).toBe(true);
  if (keyboard) {
    await control.focus();
    await expect(control).toBeFocused();
    await control.press("Enter");
  } else await control.click();
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

async function textSamples(region: Locator) {
  return region.evaluate((deck) => {
    function rgba(value: string) {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3)
        throw new Error(`Unsupported computed color: ${value}`);
      return [...channels.slice(0, 3), channels[3] ?? 1];
    }
    function background(element: Element): string {
      for (
        let ancestor: Element | null = element;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const value = getComputedStyle(ancestor).backgroundColor;
        const alpha = rgba(value)[3];
        if (alpha === 1) return value;
        if (alpha !== 0)
          throw new Error(
            `Translucent text surface needs compositing: ${value}`,
          );
      }
      throw new Error("Text has no opaque background ancestor");
    }
    function luminance(value: string) {
      const [red, green, blue] = rgba(value)
        .slice(0, 3)
        .map((channel) => {
          const normalized = channel! / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
      return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
    }
    return Array.from(deck.querySelectorAll<HTMLElement>("h2, h3, p"))
      .map((element, index) => ({ element, index }))
      .filter(
        ({ element }) =>
          !element.closest("[hidden], [inert]") &&
          element.getClientRects().length > 0,
      )
      .map(({ element, index }) => {
        const foreground = getComputedStyle(element).color;
        const surface = background(element);
        const light = luminance(foreground);
        const dark = luminance(surface);
        return {
          index,
          tag: element.tagName.toLowerCase(),
          text: element.textContent ?? "",
          foreground,
          background: surface,
          contrast:
            (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
        };
      });
  });
}

async function inspectHelp(page: Page, testInfo: TestInfo, route: string) {
  const region = page.getByRole("region", { name: copy.title, exact: true });
  const next = region.getByRole("button", {
    name: `${copy.title}の次のページ`,
  });
  const previous = region.getByRole("button", {
    name: `${copy.title}の前のページ`,
  });
  const samples: Awaited<ReturnType<typeof textSamples>> = [];
  const pages = [];
  await waitForPageLayout(page);
  await expect(previous).toBeDisabled();
  for (let index = 0; index < 100; index++) {
    samples.push(...(await textSamples(region)));
    pages.push(await region.locator("[role=status]").innerText());
    if (index === 0 || !(await next.isEnabled()))
      await attachEvidence(
        testInfo,
        `help-${route}-page-${index + 1}`,
        await page.screenshot(),
        "png",
      );
    if (!(await next.isEnabled())) break;
    await activate(next, index % 2 === 0);
    await waitForPageLayout(page);
    await expect(region.locator(".page-content")).toBeFocused();
  }
  await expect(next).toBeDisabled();
  await attachEvidence(
    testInfo,
    `help-${route}-computed-contrast`,
    JSON.stringify(
      {
        viewport: page.viewportSize(),
        browser: page.context().browser()?.version(),
        route,
        seed: SEED,
        pages,
        samples,
      },
      null,
      2,
    ),
    "json",
  );
  expect(pages.length).toBeGreaterThan(1);
  const byIndex = [
    ...new Map(samples.map((sample) => [sample.index, sample])).values(),
  ].sort((left, right) => left.index - right.index);
  expect(byIndex).toHaveLength(await region.locator("h2, h3, p").count());
  expect(
    byIndex
      .filter((sample) => sample.tag === "p")
      .map((sample) => sample.text)
      .join(""),
  ).toBe(
    [
      copy.goals.balance,
      copy.goals.choice,
      ...copy.steps.flatMap((step) => step.paragraphs),
      ...copy.settings.paragraphs,
    ].join(""),
  );
  for (const sample of samples)
    expect(
      sample.contrast,
      `${route}: ${sample.tag} ${sample.text}`,
    ).toBeGreaterThanOrEqual(4.5);
  const lastStatus = pages.at(-1);
  await activate(previous, true);
  await waitForPageLayout(page);
  await expect(region.locator("[role=status]")).not.toHaveText(lastStatus!);
  await expect(region.locator(".page-content")).toBeFocused();
  await activate(next);
  await waitForPageLayout(page);
  await expect(region.locator("[role=status]")).toHaveText(lastStatus!);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}×${viewport.height}: help retains readable text from every game screen`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const seed = page.getByRole("textbox", { name: "再現用コード（任意）" });
    await reveal(page, seed);
    await seed.fill(SEED);
    await page.getByRole("button", { name: "はじめる", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "国家ビュー", exact: true }),
    ).toBeFocused();
    expect((await savedState(page)).rng.rootSeed).toBe(SEED);

    for (const [index, [route, label]] of ROUTES.entries()) {
      const path = route === "home" ? "indicators" : route;
      const menuButton = page.getByRole("button", {
        name: "メニュー",
        exact: true,
      });
      if (index > 0) {
        await activate(menuButton);
        const destination = page
          .getByRole("region", { name: "画面メニュー", exact: true })
          .getByRole("button", { name: label, exact: true });
        await reveal(page, destination);
        await activate(destination);
      }
      await expect(page).toHaveURL(new RegExp(`/game/1/${path}$`));
      const before = await savedState(page);
      await activate(menuButton, index % 2 === 0);
      let help = page
        .getByRole("region", { name: "画面メニュー", exact: true })
        .getByRole("button", { name: copy.title, exact: true });
      await reveal(page, help);
      await activate(help);
      await inspectHelp(page, testInfo, route);
      await activate(
        page.getByRole("button", { name: copy.backToMenu, exact: true }),
        index % 2 === 0,
      );
      await waitForPageLayout(page);
      help = page
        .getByRole("region", { name: "画面メニュー", exact: true })
        .getByRole("button", { name: copy.title, exact: true });
      await reveal(page, help);
      await activate(help, true);
      await waitForPageLayout(page);
      await activate(
        page.getByRole("button", { name: copy.close, exact: true }),
        index % 2 !== 0,
      );
      await expect(menuButton).toBeFocused();
      await expect(
        page.getByRole("region", { name: copy.title, exact: true }),
      ).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/game/1/${path}$`));
      if (route === "nation")
        await attachEvidence(
          testInfo,
          "help-nation-return",
          await page.screenshot(),
          "png",
        );
      const after = await savedState(page);
      for (const key of [
        "monthIndex",
        "tickSequence",
        "economy",
        "policies",
        "rng",
      ] as const)
        expect(after[key]).toEqual(before[key]);
    }
  });
}
