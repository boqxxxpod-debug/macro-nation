import { expect, test, type Locator, type Page } from "@playwright/test";
import type { GameState } from "@macro-nation/domain";
import { waitForPageLayout } from "./paging";

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 1280, height: 800 },
] as const;
const PURPOSE =
  "暮らし・成長・安定・持続性・信頼のバランスを考え、国を育てましょう。";
const CORE_LOOP = "政策を比べる → 月を進める → 結果と理由を見る";

async function expectInViewport(target: Locator, interactive = false) {
  await expect(target).toBeVisible();
  await expect
    .poll(() =>
      target.evaluate((element, interactive) => {
        const bounds = element.getBoundingClientRect();
        const problems: string[] = [];
        if (bounds.left < -1 || bounds.right > innerWidth + 1)
          problems.push("outside viewport width");
        if (bounds.top < -1 || bounds.bottom > innerHeight + 1)
          problems.push("outside viewport height");
        if (element.scrollWidth > element.clientWidth + 2)
          problems.push("clipped width");
        if (element.scrollHeight > element.clientHeight + 2)
          problems.push("clipped height");
        if (interactive) {
          if (bounds.width < 43.5 || bounds.height < 43.5)
            problems.push("tap target smaller than 44px");
          const hit = document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
          );
          if (hit !== element && !element.contains(hit))
            problems.push("covered control");
        }
        return problems;
      }, interactive),
    )
    .toEqual([]);
}

async function expectDocumentFits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > innerWidth + 1,
        vertical: document.documentElement.scrollHeight > innerHeight + 1,
      })),
    )
    .toEqual({ horizontal: false, vertical: false });
}

async function reveal(page: Page, target: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const previous = page.getByRole("button", { name: /の前のページ$/ });
  for (let count = 0; count < 500 && (await previous.isEnabled()); count++) {
    await previous.click();
    await waitForPageLayout(page);
  }
  const next = page.getByRole("button", { name: /の次のページ$/ });
  for (let count = 0; count < 500; count++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  await expect(target).toBeVisible();
}

async function startGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeFocused();
  await waitForPageLayout(page);
}

async function savedState(page: Page, slotId = 1): Promise<GameState> {
  return page.evaluate(async (slotId) => {
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
          .get(slotId);
        request.onsuccess = () => resolve(request.result.current as GameState);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, slotId);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}×${viewport.height}: the first view explains the goal and offers the first decision`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await waitForPageLayout(page);

    await expectInViewport(page.getByText(PURPOSE, { exact: true }));
    await expectInViewport(page.getByText(CORE_LOOP, { exact: true }));
    const summary = page.getByLabel("選択中の開始設定");
    for (const value of ["入門", "4年", "学習"])
      await expect(summary).toContainText(value);
    await expect(summary).toContainText(/保存先[：:\s]*1/);
    await expectInViewport(summary);
    const start = page.getByRole("button", { name: "はじめる", exact: true });
    await expectInViewport(start, true);
    await expectDocumentFits(page);
    await testInfo.attach(`onboarding-start-${viewport.width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    const evaluation = page.getByText(/終了時は.*5つの軸で評価します/);
    await reveal(page, evaluation);
    for (const axis of ["暮らし", "成長", "安定", "持続性", "信頼"])
      await expect(evaluation).toContainText(axis);
    await expectInViewport(evaluation);
    await expectInViewport(start, true);

    await start.click();
    await expect(
      page.getByRole("heading", { name: "国家ビュー" }),
    ).toBeFocused();
    await waitForPageLayout(page);
    const guide = page.getByRole("region", { name: "最初の一手" });
    await expectInViewport(guide);
    await expectInViewport(guide.getByRole("heading", { name: "最初の一手" }));
    await expectInViewport(
      guide.getByText(
        "新しい政策を加えず、上の「1か月進める」で進行できます。",
        { exact: true },
      ),
    );
    await expectInViewport(
      guide.getByText("進めた後は、レポートで結果と理由を確認しましょう。", {
        exact: true,
      }),
    );
    const policy = guide.getByRole("button", { name: "政策を検討する" });
    await expectInViewport(policy, true);
    await expectInViewport(
      page.getByRole("button", { name: "1か月進める" }),
      true,
    );
    await expectInViewport(
      page.getByRole("button", { name: "理由を見る", exact: true }),
      true,
    );
    const indicators = page.getByRole("group", { name: "国家の主要指標" });
    await expectInViewport(indicators);
    await expect(indicators.locator(".nation-score")).toHaveCount(5);
    for (const indicator of await indicators.locator(".nation-score").all())
      await expectInViewport(indicator);
    await expectInViewport(page.getByRole("region", { name: "時間の進行" }));
    await expectDocumentFits(page);
    await testInfo.attach(`onboarding-nation-${viewport.width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    await policy.click();
    await expect(
      page.getByRole("heading", { name: "政策会議", exact: true }),
    ).toBeFocused();
    expect(
      (await savedState(page)).policyAdministration?.receipts ?? [],
    ).toEqual([]);
  });
}

test("the fixed start summary reflects changed settings before they are saved", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  const summary = page.getByLabel("選択中の開始設定");
  const slot = page.getByRole("button", { name: "保存先2ではじめる" });
  await reveal(page, slot);
  await slot.click();
  await expect(summary).toContainText(/保存先[：:\s]*2/);
  await expectInViewport(summary);

  const difficulty = page.getByRole("combobox", { name: "難易度" });
  await reveal(page, difficulty);
  await difficulty.selectOption("expert");
  await expect(summary).toContainText("専門");
  await expectInViewport(summary);

  const duration = page.getByRole("radio", { name: /8年（96か月）/ });
  await reveal(page, duration);
  await duration.check();
  await expect(summary).toContainText("8年");
  await expectInViewport(summary);

  const mode = page.getByRole("combobox", { name: "説明モード" });
  await reveal(page, mode);
  await mode.selectOption("casual");
  await expect(summary).toContainText("カジュアル");
  await expectInViewport(summary);
  await expectInViewport(
    page.getByRole("button", { name: "はじめる", exact: true }),
    true,
  );
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeFocused();
  const saved = await savedState(page, 2);
  expect(saved).toMatchObject({
    slotId: 2,
    difficulty: "expert",
    durationMode: "standard",
    learningMode: "casual",
    monthIndex: 0,
  });
});

test("the no-new-policy choice advances exactly one month and survives reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await startGame(page);
  const before = await savedState(page);
  expect(before.monthIndex).toBe(0);
  await expect(page.getByRole("region", { name: "最初の一手" })).toContainText(
    "新しい政策を加えず",
  );
  await page.getByRole("button", { name: "1か月進める" }).click();
  await expect.poll(async () => (await savedState(page)).monthIndex).toBe(1);
  const after = await savedState(page);
  expect(after.tickSequence).toBe(before.tickSequence + 1);
  expect(after.policies).toEqual(before.policies);
  expect(after.policyAdministration?.receipts ?? []).toEqual([]);
  expect(after.economy).not.toEqual(before.economy);
  expect(after.clock.progressionMode).toBe("manual");

  await page.getByRole("button", { name: "理由を見る", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "経済レポート" }),
  ).toBeFocused();
  await reveal(page, page.getByRole("heading", { name: "変化の理由" }).first());
  await page.getByRole("button", { name: "国家ビューに戻る" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  const reloaded = await savedState(page);
  expect(reloaded.monthIndex).toBe(1);
  expect(reloaded.tickSequence).toBe(after.tickSequence);
  expect(reloaded.economy).toEqual(after.economy);
  expect(reloaded.policies).toEqual(after.policies);
  expect(reloaded.rng).toEqual(after.rng);

  // The existing four-quarter learning guide remains reachable from indicators.
  await page.getByRole("button", { name: "経済指標を見る" }).click();
  await page
    .getByRole("combobox", { name: "ホームの詳細" })
    .selectOption({ label: "はじめの案内" });
  await reveal(
    page,
    page.getByRole("heading", { name: "はじめの4四半期・第1回" }).first(),
  );
  expect((await savedState(page)).monthIndex).toBe(1);
});

test("the first guide can be closed, reopened, and revisited through help", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await startGame(page);
  const before = await savedState(page);
  const guide = page.getByRole("region", { name: "最初の一手" });
  await guide.getByRole("button", { name: "案内を閉じる" }).click();
  await expect(guide).not.toBeVisible();
  const reopen = page.getByRole("button", { name: "案内を再表示" });
  await expectInViewport(reopen, true);
  await expectInViewport(page.locator(".nation-scene"));
  await reopen.click();
  await expectInViewport(guide);
  await guide.getByRole("button", { name: "案内を閉じる" }).click();

  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  const help = page.getByRole("button", { name: "遊び方・設定", exact: true });
  await reveal(page, help);
  await help.click();
  for (const step of ["政策を比べる", "月を進める", "結果と理由を見る"]) {
    const explanation = page.getByText(step, { exact: false }).first();
    await reveal(page, explanation);
    await expect(explanation).toBeVisible();
  }
  const after = await savedState(page);
  expect(after.monthIndex).toBe(before.monthIndex);
  expect(after.tickSequence).toBe(before.tickSequence);
  expect(after.economy).toEqual(before.economy);
  expect(after.policies).toEqual(before.policies);
});

test("360×640 learning guide explains how to return from automatic to manual progression", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await startGame(page);
  const before = await savedState(page);
  const guide = page.getByRole("region", { name: "最初の一手" });
  const mode = page.getByRole("combobox", { name: "時間の進め方" });
  const manual = page.getByRole("button", { name: "1か月進める" });
  await mode.selectOption("auto");
  await waitForPageLayout(page);
  const automatic = page.getByRole("button", { name: "自動進行を始める" });
  await expect(manual).toBeDisabled();
  await expect(automatic).toBeDisabled();
  await expectInViewport(mode, true);
  await expectInViewport(automatic, true);
  await expectInViewport(manual, true);
  await expectInViewport(guide);
  await expectInViewport(
    guide.getByText(
      "案内期間は手動で進めます。上で手動を選び、「1か月進める」で進行できます。",
      { exact: true },
    ),
  );
  await expectDocumentFits(page);

  await mode.selectOption("manual");
  await expect(manual).toBeEnabled();
  await expect(automatic).toHaveCount(0);
  await expectInViewport(
    guide.getByText("新しい政策を加えず、上の「1か月進める」で進行できます。", {
      exact: true,
    }),
  );
  const after = await savedState(page);
  expect(after.clock.progressionMode).toBe("manual");
  expect(after.monthIndex).toBe(before.monthIndex);
  expect(after.tickSequence).toBe(before.tickSequence);
  expect(after.economy).toEqual(before.economy);
});

test("360×640 casual guide offers automatic progression without adding a policy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  const explanationMode = page.getByRole("combobox", { name: "説明モード" });
  await reveal(page, explanationMode);
  await explanationMode.selectOption("casual");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeFocused();
  const before = await savedState(page);
  const guide = page.getByRole("region", { name: "最初の一手" });
  await page
    .getByRole("combobox", { name: "時間の進め方" })
    .selectOption("auto");
  await waitForPageLayout(page);
  const automatic = page.getByRole("button", { name: "自動進行を始める" });
  await expect(automatic).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "1か月進める" }),
  ).toBeDisabled();
  await expectInViewport(automatic, true);
  await expectInViewport(guide);
  await expectInViewport(
    guide.getByText(
      "新しい政策を加えず、上の時間操作で自動進行を開始・再開できます。",
      { exact: true },
    ),
  );
  await expectDocumentFits(page);

  await automatic.click();
  const pause = page.getByRole("button", { name: "一時停止", exact: true });
  await expect(pause).toBeEnabled();
  await expect
    .poll(async () => (await savedState(page)).runState)
    .toBe("running");
  await pause.click();
  await expect(
    page.getByRole("button", { name: "再開", exact: true }),
  ).toBeEnabled();
  const after = await savedState(page);
  expect(after.clock.progressionMode).toBe("auto");
  expect(after.monthIndex).toBe(before.monthIndex);
  expect(after.tickSequence).toBe(before.tickSequence);
  expect(after.economy).toEqual(before.economy);
  expect(after.policies).toEqual(before.policies);
});
