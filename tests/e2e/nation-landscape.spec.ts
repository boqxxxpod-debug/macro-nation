import { expect, test, type Page } from "@playwright/test";
import type { GameState } from "@macro-nation/domain";

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

async function seedLandscape(
  page: Page,
  original: GameState,
  ratios: readonly number[],
) {
  await page.evaluate(
    async ({ original, ratios }) => {
      const base = original.history.reports![0]!;
      const scale = (value: number | undefined, ratio: number) =>
        (value ?? 100) * ratio;
      const reports = ratios.map((ratio, monthIndex) => ({
        ...base,
        monthIndex,
        values: {
          ...base.values,
          realGdp: scale(base.values.realGdp, ratio),
          manufacturing: scale(base.values.manufacturing, ratio),
          agriculture: scale(base.values.agriculture, ratio),
          exports: scale(base.values.exports, ratio),
          imports: scale(base.values.imports, ratio),
          transport: scale(base.values.transport, ratio),
          energy: scale(base.values.energy, ratio),
        },
      }));
      const ratio = ratios.at(-1)!;
      const monthIndex = ratios.length - 1;
      const next: GameState = {
        ...original,
        monthIndex,
        tickSequence: monthIndex,
        clock: {
          ...original.clock,
          year: original.clock.year + Math.floor(monthIndex / 12),
          month: (monthIndex % 12) + 1,
        },
        economy: {
          ...original.economy,
          indices: {
            ...original.economy.indices,
            realGdp: scale(
              base.values.realGdp,
              ratio,
            ) as typeof original.economy.indices.realGdp,
          },
          industries: {
            ...original.economy.industries,
            manufacturing: {
              ...original.economy.industries.manufacturing,
              productionIndex: scale(
                base.values.manufacturing,
                ratio,
              ) as typeof original.economy.industries.manufacturing.productionIndex,
            },
            agricultureResources: {
              ...original.economy.industries.agricultureResources,
              productionIndex: scale(
                base.values.agriculture,
                ratio,
              ) as typeof original.economy.industries.agricultureResources.productionIndex,
            },
          },
          flows: {
            ...original.economy.flows,
            exports: scale(
              base.values.exports,
              ratio,
            ) as typeof original.economy.flows.exports,
            imports: scale(
              base.values.imports,
              ratio,
            ) as typeof original.economy.flows.imports,
          },
          infrastructure: {
            ...original.economy.infrastructure,
            transport: scale(
              base.values.transport,
              ratio,
            ) as typeof original.economy.infrastructure.transport,
            energy: scale(
              base.values.energy,
              ratio,
            ) as typeof original.economy.infrastructure.energy,
          },
        },
        history: { ...original.history, reports },
      };
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
          request.onsuccess = () =>
            store.put({ ...request.result, current: next });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    },
    { original, ratios },
  );
}

test("four confirmed landscapes share terrain and stable plots", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  const homeUrl = page.url();
  const original = await savedState(page);
  const fixtures = [
    { name: "low", ratio: 0.6 },
    { name: "stable", ratio: 1 },
    { name: "active", ratio: 1.1 },
    { name: "very-active", ratio: 1.4 },
  ];
  let commonImage: string | undefined;
  let commonBounds: number[] | undefined;
  const counts: number[][] = [];
  const stablePlots = new Map<string, string>();
  for (const fixture of fixtures) {
    await seedLandscape(page, original, [1, ...Array(9).fill(fixture.ratio)]);
    await page.goto(homeUrl);
    await expect(
      page.getByRole("heading", { name: "国家ホーム" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "国家ビュー", exact: true }).click();
    await expect(page.locator(".nation-structures")).toBeVisible();
    const scene = page.locator(".nation-scene");
    const screenshot = testInfo.outputPath(`nation-${fixture.name}.png`);
    await scene.screenshot({ path: screenshot });
    await testInfo.attach(`nation-${fixture.name}`, {
      path: screenshot,
      contentType: "image/png",
    });
    const snapshot = await page.evaluate(() => {
      const image =
        document.querySelector<HTMLImageElement>(".nation-landscape")!;
      const scene = document.querySelector<HTMLElement>(".nation-scene")!;
      const structures = Array.from(
        document.querySelectorAll<SVGSVGElement>("[data-structure]"),
      ).map((node) => ({
        id: node.dataset.structure!,
        kind: node.dataset.kind!,
        plot: [
          node.getAttribute("x"),
          node.getAttribute("y"),
          node.getAttribute("width"),
          node.getAttribute("height"),
        ].join(":"),
      }));
      const bounds = scene.getBoundingClientRect();
      return {
        image: image.currentSrc,
        bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
        structures,
      };
    });
    commonImage ??= snapshot.image;
    commonBounds ??= snapshot.bounds;
    expect(snapshot.image).toBe(commonImage);
    expect(snapshot.bounds).toEqual(commonBounds);
    counts.push(
      (["city", "industry", "harbor"] as const).map(
        (region) =>
          snapshot.structures.filter((item) => item.id.startsWith(`${region}-`))
            .length,
      ),
    );
    for (const item of snapshot.structures) {
      const old = stablePlots.get(item.id);
      if (old) expect(item.plot).toBe(old);
      stablePlots.set(item.id, item.plot);
    }
    if (fixture.name === "very-active") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".nation-motion-canvas")).toHaveAttribute(
        "data-motion",
        "still",
      );
      await page.getByRole("button", { name: "表示設定" }).click();
      await page
        .getByRole("combobox", { name: "景観の画質" })
        .selectOption("low");
      await page.getByRole("button", { name: "詳細を閉じる" }).click();
      await expect(page.locator("[data-structure]")).toHaveCount(28);
      await page.evaluate(async () => navigator.serviceWorker.ready);
      await context.setOffline(true);
      await page.reload();
      await expect(page.locator(".nation-structures")).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator(".nation-landscape")
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBe(941);
      await expect(page.locator("[data-structure]")).toHaveCount(28);
      await context.setOffline(false);
    }
    await page.goto(homeUrl);
  }
  expect(counts).toEqual([
    [1, 1, 1],
    [2, 2, 2],
    [3, 3, 3],
    [4, 4, 4],
  ]);
  expect(
    [...stablePlots.keys()].filter((id) => id.startsWith("city-")),
  ).toHaveLength(4);
});

test("a short slump changes operation before buildings and recovery uses the same plots", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  const homeUrl = page.url();
  const original = await savedState(page);
  const growth = [1, ...Array(4).fill(1.4)];
  const shortSlump = [...growth, 0.6];
  const longSlump = [...growth, ...Array(8).fill(0.6)];
  const earlyRecovery = [...longSlump, 1.4];
  const recovery = [...longSlump, ...Array(4).fill(1.4)];
  const cases = [
    { name: "built", ratios: growth, count: 4, status: "peak" },
    { name: "short-slump", ratios: shortSlump, count: 4, status: "quiet" },
    { name: "long-slump", ratios: longSlump, count: 1, status: "quiet" },
    { name: "early-recovery", ratios: earlyRecovery, count: 1, status: "peak" },
    { name: "recovered", ratios: recovery, count: 4, status: "peak" },
  ];
  let originalPlot: string | undefined;
  for (const example of cases) {
    await seedLandscape(page, original, example.ratios);
    await page.goto(homeUrl);
    await page.getByRole("button", { name: "国家ビュー", exact: true }).click();
    const city = page.locator("[data-structure^='city-']");
    await expect(city).toHaveCount(example.count);
    await expect(city.first()).toHaveAttribute("data-status", example.status);
    const plot = await city
      .first()
      .evaluate((node) =>
        ["x", "y", "width", "height"]
          .map((attribute) => node.getAttribute(attribute))
          .join(":"),
      );
    originalPlot ??= plot;
    expect(plot).toBe(originalPlot);
    const screenshot = testInfo.outputPath(`nation-${example.name}.png`);
    await page.locator(".nation-scene").screenshot({ path: screenshot });
    await testInfo.attach(`nation-${example.name}`, {
      path: screenshot,
      contentType: "image/png",
    });
    await page.goto(homeUrl);
  }
});
