import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { waitForEnlargedText, waitForPageLayout } from "./paging";

type ApprovedExpert = {
  expertId: string;
  displayName: string;
  role: string;
  altText: string;
  variants: { density: "1x" | "2x"; file: string }[];
};
// Compare the UI against the approved asset handoff, independently of the
// application manifest. Node's test runner need not import browser content code.
const approvedAssets = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/assets/expert-portraits-v1/manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { experts: ApprovedExpert[] };
const content = JSON.parse(
  readFileSync(
    new URL(
      "../../packages/advisor-core/src/content-v1.2.0.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { tones: Record<string, string> };
const toneKeys: Record<string, string> = {
  centralBank: "measured",
  fiscal: "cautious",
  macro: "teacher",
  industry: "direct",
  labor: "friendly",
  social: "empathetic",
  demography: "longView",
  environmentEnergy: "balanced",
};
const expertProfiles = approvedAssets.experts.map((expert) => ({
  id: expert.expertId,
  displayName: expert.displayName,
  role: expert.role,
  tone: content.tones[toneKeys[expert.expertId]!]!,
}));
const expertPortraitManifest = approvedAssets.experts.map((expert) => ({
  expertId: expert.expertId,
  altText: expert.altText,
  src: expert.variants
    .find((variant) => variant.density === "1x")!
    .file.replace("apps/web/public/", ""),
  src2x: expert.variants
    .find((variant) => variant.density === "2x")!
    .file.replace("apps/web/public/", ""),
}));

test.setTimeout(240_000);

async function reveal(page: Page, target: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const previous = page.getByRole("button", { name: /の前のページ$/ });
  for (let count = 0; count < 400 && (await previous.isEnabled()); count++) {
    await previous.click();
    await waitForPageLayout(page);
  }
  const next = page.getByRole("button", { name: /の次のページ$/ });
  for (let count = 0; count < 400; count++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  await expect(target).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function openMeeting(page: Page, baseURL: string | undefined) {
  await page.goto(baseURL ?? "/");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
  await page.getByRole("button", { name: "政策会議", exact: true }).click();
  await expect(page.getByRole("heading", { name: "政策会議" })).toBeFocused();
  await waitForPageLayout(page);
}

function pickerCard(page: Page, expertId: string) {
  const profile = expertProfiles.find((item) => item.id === expertId)!;
  return page.locator(".expert-picker label").filter({
    has: page.locator("strong", { hasText: profile.displayName }),
  });
}

function expertCheckbox(page: Page, expertId: string) {
  return pickerCard(page, expertId).locator('input[type="checkbox"]');
}

async function selectExperts(page: Page, ids: readonly string[]) {
  let selected = await page.locator(".expert-picker input:checked").count();
  for (const profile of expertProfiles) {
    const checkbox = expertCheckbox(page, profile.id);
    if (
      !ids.includes(profile.id) &&
      selected > 1 &&
      (await checkbox.isChecked())
    ) {
      await reveal(page, checkbox);
      await checkbox.uncheck();
      selected--;
    }
  }
  if (!(await expertCheckbox(page, ids[0]!).isChecked())) {
    const first = expertCheckbox(page, ids[0]!);
    await reveal(page, first);
    await first.check();
  }
  for (const profile of expertProfiles) {
    const checkbox = expertCheckbox(page, profile.id);
    if (!ids.includes(profile.id) && (await checkbox.isChecked())) {
      await reveal(page, checkbox);
      await checkbox.uncheck();
    }
  }
  for (const id of ids) {
    const checkbox = expertCheckbox(page, id);
    if (!(await checkbox.isChecked())) {
      await reveal(page, checkbox);
      await checkbox.check();
    }
  }
  await expect(page.locator(".expert-picker input:checked")).toHaveCount(
    ids.length,
  );
}

async function openPreview(page: Page) {
  await page.getByRole("button", { name: "見通しを確認" }).click();
  await expect(page.getByRole("heading", { name: "政策の見通し" })).toBeFocused(
    { timeout: 60_000 },
  );
  await waitForPageLayout(page);
}

async function expectLoaded(portrait: Locator) {
  await expect
    .poll(() =>
      portrait.evaluate(
        (element: HTMLImageElement) =>
          element.complete &&
          element.naturalWidth > 0 &&
          element.naturalWidth === element.naturalHeight,
      ),
    )
    .toBe(true);
}

async function expectLayout(page: Page, target: Locator, enlarged = false) {
  await expect
    .poll(() =>
      page.evaluate((enlarged) => {
        const root = document.documentElement;
        return (
          root.scrollWidth <= innerWidth + 1 &&
          (enlarged || root.scrollHeight <= innerHeight + 1)
        );
      }, enlarged),
    )
    .toBe(true);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  if (!enlarged) {
    expect(box!.y).toBeGreaterThanOrEqual(-1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
  }
  expect(
    await target.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
}

async function expectPreviewIdentity(
  page: Page,
  ids: readonly string[],
  loaded = true,
  testInfo?: TestInfo,
) {
  const expectedIdentities = ids
    .map((id) => {
      const profile = expertProfiles.find((item) => item.id === id)!;
      return `${profile.displayName} · 口調：${profile.tone}`;
    })
    .sort();
  expect(
    [
      ...new Set(await page.locator(".expert-advice .quiet").allTextContents()),
    ].sort(),
  ).toEqual(expectedIdentities);
  for (const id of ids) {
    const profile = expertProfiles.find((item) => item.id === id)!;
    const asset = expertPortraitManifest.find((item) => item.expertId === id)!;
    const header = page
      .locator(".expert-advice .expert-identity")
      .filter({
        hasText: `${profile.displayName} · 口調：${profile.tone}`,
      })
      .first();
    await reveal(page, header);
    await expect(header.locator(".quiet")).toBeVisible();
    await expect(header.locator("h4")).toHaveText(profile.role);
    if (loaded) {
      const portrait = header.locator("img");
      await expect(portrait).toBeVisible();
      await expect(portrait).toHaveAttribute("alt", asset.altText);
      await expectLoaded(portrait);
    }
    const enlarged = await page.evaluate(
      () =>
        Number.parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        ) >= 24,
    );
    await expectLayout(page, header, enlarged);
    if (testInfo)
      await capture(
        page,
        testInfo,
        `advice-${page.viewportSize()!.width}-${profile.id}`,
      );
  }
}

async function inspectAdvicePages(page: Page, ids: readonly string[]) {
  const previous = page.getByRole("button", {
    name: "政策の見通しの前のページ",
  });
  for (let count = 0; count < 400 && (await previous.isEnabled()); count++) {
    await previous.click();
    await waitForPageLayout(page);
  }
  const next = page.getByRole("button", {
    name: "政策の見通しの次のページ",
  });
  let adviceFragments = 0;
  for (let count = 0; count < 400; count++) {
    const fragments = page.locator(".expert-advice:visible");
    for (const fragment of await fragments.all()) {
      const header = fragment.locator(".expert-identity");
      await expect(header).toBeVisible();
      const identity = await header.locator(".quiet").textContent();
      const profile = expertProfiles.find(
        (item) => identity === `${item.displayName} · 口調：${item.tone}`,
      );
      expect(profile).toBeDefined();
      expect(ids).toContain(profile!.id);
      const asset = expertPortraitManifest.find(
        (item) => item.expertId === profile!.id,
      )!;
      await expect(header.locator("h4")).toHaveText(profile!.role);
      await expect(header.locator("img")).toBeVisible();
      await expect(header.locator("img")).toHaveAttribute("alt", asset.altText);
      await expectLayout(page, fragment);
      adviceFragments++;
    }
    const content = page.locator(
      '[data-page-current][aria-label="政策の見通しの内容"]',
    );
    await expect
      .poll(() =>
        content.evaluate((element) => ({
          widthFits: element.scrollWidth <= element.clientWidth + 1,
          heightFits: element.scrollHeight <= element.clientHeight + 1,
        })),
      )
      .toEqual({ widthFits: true, heightFits: true });
    for (const button of await page
      .locator(".page-actions button:visible")
      .all()) {
      await expectLayout(page, button);
      expect(
        await button.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
          );
          return hit === element || (!!hit && element.contains(hit));
        }),
      ).toBe(true);
    }
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  expect(adviceFragments).toBeGreaterThanOrEqual(ids.length);
}

for (const viewport of [
  { width: 360, height: 640 },
  { width: 1366, height: 768 },
]) {
  test(`${viewport.width}px: all eight approved WebP portraits load with readable identities`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await openMeeting(page, baseURL);
    await expect(page.locator(".expert-picker .expert-portrait")).toHaveCount(
      8,
    );
    for (const profile of expertProfiles) {
      const card = pickerCard(page, profile.id);
      const portrait = card.locator(".expert-portrait img");
      const asset = expertPortraitManifest.find(
        (item) => item.expertId === profile.id,
      )!;
      await reveal(page, card);
      await expectLoaded(portrait);
      await expect(portrait).toHaveAttribute("alt", asset.altText);
      await expect(portrait).toHaveAttribute(
        "src",
        new URL(asset.src, baseURL).pathname,
      );
      await expect(portrait).toHaveAttribute(
        "srcset",
        `${new URL(asset.src, baseURL).pathname} 1x, ${new URL(asset.src2x, baseURL).pathname} 2x`,
      );
      await expect(card).toContainText(profile.displayName!);
      await expect(card).toContainText(`${profile.role} · ${profile.tone}`);
      await expectLayout(page, card);
      await capture(page, testInfo, `picker-${viewport.width}-${profile.id}`);
    }
  });
}

test.describe("high density portraits", () => {
  test.use({ deviceScaleFactor: 2 });

  test("a 2x display requests the matching 512px variant for all eight experts", async ({
    page,
    baseURL,
  }) => {
    await openMeeting(page, baseURL);
    expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
    for (const asset of expertPortraitManifest) {
      const portrait = pickerCard(page, asset.expertId).locator(
        ".expert-portrait img",
      );
      await reveal(page, portrait);
      await expectLoaded(portrait);
      await expect
        .poll(() =>
          portrait.evaluate((img: HTMLImageElement) => img.currentSrc),
        )
        .toBe(new URL(asset.src2x, baseURL).href);
    }
  });
});

for (const width of [360, 1366]) {
  test(`${width}px: keyboard selection enforces one to three and every portrait follows its expert into UI05`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 360 ? 640 : 768 });
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== new URL(baseURL!).origin)
        externalRequests.push(request.url());
    });
    await openMeeting(page, baseURL);
    const macro = expertCheckbox(page, "macro");
    await expect(macro).toBeChecked();
    await expect(macro).toBeDisabled();
    await openPreview(page);
    await expectPreviewIdentity(page, ["macro"]);
    await page.getByRole("button", { name: "案を修正する" }).click();
    for (const id of ["centralBank", "fiscal"]) {
      const checkbox = expertCheckbox(page, id);
      await reveal(page, checkbox);
      await checkbox.focus();
      await page.keyboard.press("Space");
      await expect(checkbox).toBeChecked();
    }
    await expect(page.locator(".expert-picker input:checked")).toHaveCount(3);
    await expect(
      page.locator(".expert-picker input:not(:checked):disabled"),
    ).toHaveCount(5);
    for (const ids of [
      ["centralBank", "fiscal", "macro"],
      ["industry", "labor", "social"],
      ["demography", "environmentEnergy", "macro"],
    ]) {
      await selectExperts(page, ids);
      const selectedSources = new Map(
        await Promise.all(
          ids.map(
            async (id) =>
              [
                id,
                await pickerCard(page, id).locator("img").getAttribute("src"),
              ] as const,
          ),
        ),
      );
      await openPreview(page);
      await expectPreviewIdentity(page, ids, true, testInfo);
      await inspectAdvicePages(page, ids);
      for (const id of ids) {
        const asset = expertPortraitManifest.find(
          (item) => item.expertId === id,
        )!;
        const portrait = page
          .locator(".expert-advice img")
          .and(page.getByAltText(asset.altText))
          .first();
        await expect(portrait).toHaveAttribute("src", selectedSources.get(id)!);
      }
      await page.getByRole("button", { name: "案を修正する" }).click();
      await expect(page.locator(".expert-picker input:checked")).toHaveCount(3);
    }
    await selectExperts(page, ["macro"]);
    await expect(macro).toBeDisabled();
    expect(externalRequests).toEqual([]);
  });
}

test.describe("portraits remain optional", () => {
  test.use({ serviceWorkers: "block" });
  for (const mode of ["failed", "hidden"] as const) {
    test(`${mode} images preserve all eight names, roles and tones and permit preview`, async ({
      page,
      baseURL,
    }) => {
      if (mode === "failed") {
        await page.route("**/experts/*.webp", (route) => route.abort());
      }
      await openMeeting(page, baseURL);
      if (mode === "hidden") {
        await page.addStyleTag({
          content: ".expert-portrait { display: none !important; }",
        });
      }
      for (const profile of expertProfiles) {
        const card = pickerCard(page, profile.id);
        await reveal(page, card);
        if (mode === "failed") {
          await expect(card.locator(".expert-portrait img")).toHaveCount(0);
          await expect(card.locator(".expert-portrait-fallback")).toBeVisible();
        } else {
          await expect(card.locator(".expert-portrait")).toBeHidden();
        }
        await expect(card.locator("strong")).toBeVisible();
        await expect(card.locator(".expert-role")).toContainText(
          `${profile.role} · ${profile.tone}`,
        );
        await expectLayout(page, card);
      }
      await selectExperts(page, ["centralBank", "labor", "environmentEnergy"]);
      await openPreview(page);
      await expectPreviewIdentity(
        page,
        ["centralBank", "labor", "environmentEnergy"],
        false,
      );
      await expect(page.locator(".expert-advice img:visible")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "案を修正する" }),
      ).toBeEnabled();
    });
  }
});

test("360px and 200% text retain keyboard selection, identity and confirmation", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMeeting(page, baseURL);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await waitForEnlargedText(page);
  await waitForPageLayout(page);
  for (const profile of expertProfiles) {
    const card = pickerCard(page, profile.id);
    await expect(card.locator("strong")).toBeVisible();
    await expect(card.locator(".expert-role")).toContainText(profile.role);
    await expectLayout(page, card, true);
  }
  for (const id of ["fiscal", "labor"]) {
    const checkbox = expertCheckbox(page, id);
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
  }
  const preview = page.getByRole("button", { name: "見通しを確認" });
  await preview.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "政策の見通し" })).toBeFocused(
    { timeout: 60_000 },
  );
  await expectPreviewIdentity(page, ["macro", "fiscal", "labor"]);
  const reviewed = page.getByRole("checkbox", {
    name: "費用・副作用・警告を確認しました",
  });
  await reviewed.focus();
  await page.keyboard.press("Space");
  const confirm = page.getByRole("button", { name: "政策を確定する" });
  await expect(confirm).toBeEnabled();
  await expectLayout(page, confirm, true);
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
});

test("production precache serves every 1x and 2x portrait offline without repeated transfers", async ({
  context,
  page,
  baseURL,
}) => {
  await openMeeting(page, baseURL);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "政策会議" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const expectedAssets = expertPortraitManifest
    .flatMap((asset) => [asset.src, asset.src2x])
    .map((src) => new URL(src, baseURL).href);
  await expect
    .poll(() =>
      page.evaluate(async (urls) => {
        const found = await Promise.all(
          urls.map(
            async (url) =>
              (await caches.match(url, { ignoreSearch: true }))?.ok ?? false,
          ),
        );
        return found.every(Boolean);
      }, expectedAssets),
    )
    .toBe(true);
  await context.setOffline(true);
  const decoded = await page.evaluate(
    async (urls) =>
      Promise.all(
        urls.map(async (url) => {
          const response = await fetch(url);
          const bitmap = await createImageBitmap(await response.blob());
          const dimensions = {
            url,
            width: bitmap.width,
            height: bitmap.height,
          };
          bitmap.close();
          return dimensions;
        }),
      ),
    expectedAssets,
  );
  for (const image of decoded) {
    expect(image.width).toBe(image.url.endsWith("@2x.webp") ? 512 : 256);
    expect(image.height).toBe(image.width);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "政策会議" })).toBeVisible();
  for (const profile of expertProfiles) {
    const portrait = pickerCard(page, profile.id).locator(
      ".expert-portrait img",
    );
    await reveal(page, portrait);
    await expectLoaded(portrait);
  }
  await page.evaluate(() => performance.clearResourceTimings());
  await selectExperts(page, ["macro", "social", "demography"]);
  for (let iteration = 0; iteration < 2; iteration++) {
    await openPreview(page);
    await expectPreviewIdentity(page, ["macro", "social", "demography"]);
    await page.getByRole("button", { name: "案を修正する" }).click();
  }
  const requests = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/experts/"))
      .map((entry) => ({
        name: entry.name,
        transferSize: (entry as PerformanceResourceTiming).transferSize,
      })),
  );
  expect(requests.every((request) => request.transferSize === 0)).toBe(true);
  expect(
    requests.every((request) => expectedAssets.includes(request.name)),
  ).toBe(true);
});
