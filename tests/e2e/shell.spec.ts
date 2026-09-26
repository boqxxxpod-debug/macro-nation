import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("360px PWA shell renders and remains available offline after first load", async ({
  context,
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "MACRO NATION" }),
  ).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "MACRO NATION" }),
  ).toBeVisible();

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "MACRO NATION" }),
  ).toBeVisible();
});

test("foundation shell has no serious or critical axe violations", async ({
  page,
}) => {
  await page.goto("/");

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );

  expect(blocking).toEqual([]);
});

test("mobile policy journey persists through reload and browser back", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
  await page.getByRole("button", { name: "政策を考える" }).click();
  await page.getByRole("spinbutton", { name: "政策金利の設定値" }).fill("0.05");
  await page.getByRole("button", { name: "12か月を比較する" }).click();
  await expect(
    page.getByRole("heading", { name: "政策プレビュー" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "無追加政策との12か月比較" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "政策を確定して保存" }).click();
  await expect(
    page.getByText("政策を確定し、端末に保存しました。"),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await page.getByRole("button", { name: "政策会議" }).click();
  await expect(page.getByText(/残り 2 \/ 3枠/)).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await page.getByRole("button", { name: "1か月進める" }).click();
  await expect(
    page.getByRole("heading", { name: "今月の3行報告" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "理由を見る" }).click();
  await expect(
    page.getByRole("heading", { name: "今月の主な原因" }),
  ).toBeVisible();
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(hasOverflow).toBe(false);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("keyboard, enlarged text, and reduced motion retain primary actions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: "説明モード" }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.getByRole("radio", { name: /30年/ }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: /30年/ })).toBeChecked();
  await page.getByRole("textbox", { name: "再現用seed（任意）" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "ゲームを始める" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
  await expect(page.getByRole("button", { name: "1か月進める" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "政策を考える" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("duration, difficulty, learning mode, seed, and slot survive reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "スロット2で新しく始める" }).click();
  await page.getByRole("combobox", { name: "難易度" }).selectOption("expert");
  await page.getByRole("radio", { name: /20年/ }).check();
  await page
    .getByRole("combobox", { name: "説明モード" })
    .selectOption("casual");
  await page
    .getByRole("textbox", { name: "再現用seed（任意）" })
    .fill("issue-17-seed");
  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await page.getByRole("button", { name: "保存スロット" }).click();
  await expect(page.getByText(/20年・240か月・expert・casual/)).toBeVisible();
  await page.getByRole("button", { name: "スロット2の続きから" }).click();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("first playable reaches the 48-month ending without a policy", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "再現用seed（任意）" })
    .fill("first-playable-48");
  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await expect(
    page.getByRole("heading", { name: "はじめの4四半期・第1回" }),
  ).toBeVisible();
  for (let month = 0; month < 48; month += 1) {
    await page.getByRole("button", { name: "1か月進める" }).click();
    if (month < 47) {
      const completed = month + 1;
      await expect(
        page.getByText(
          `${Math.floor(completed / 12) + 1}年目 ${(completed % 12) + 1}月まで進み、保存しました。`,
        ),
      ).toBeVisible();
    }
  }
  await expect(page.getByRole("heading", { name: "終了評価" })).toBeVisible();
  await expect(page.getByText("48か月の運営が完了しました。")).toBeVisible();
  await expect(page.getByRole("heading", { name: /総合評価/ })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "最も大きな変化と原因" }),
  ).toBeVisible();
});

test("a saved game can advance and reload while offline", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.getByRole("button", { name: "1か月進める" }).click();
  await expect(
    page.getByRole("heading", { name: "今月の3行報告" }),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "今月の3行報告" }),
  ).toBeVisible();
});

test("nation regions remain accessible with reduced motion and after direct reload", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await page.getByRole("button", { name: "国家ビュー" }).click();
  await expect(page).toHaveURL(/\/game\/1\/nation$/);
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  await expect(page.locator("canvas.nation-motion-canvas")).toHaveCount(0);
  await expect(page.getByText("動きの軽減: 静止表示")).toBeVisible();
  await expect(page.locator("img.nation-landscape")).toHaveJSProperty(
    "naturalWidth",
    941,
  );
  await expect(page.getByRole("button", { name: /港湾を選択/ })).toBeVisible();
  await page.getByRole("button", { name: /港湾を選択/ }).click();
  await expect(
    page.getByRole("region", { name: "港湾の地域詳細" }),
  ).toContainText("輸出（月間）");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  await page
    .getByRole("region", { name: "地域一覧" })
    .getByRole("button", { name: /港湾/ })
    .click();
  await expect(
    page.getByRole("region", { name: "港湾の地域詳細" }),
  ).toContainText("輸出（月間）");
  await page.reload();
  await expect(page.getByRole("region", { name: "地域一覧" })).toBeVisible();
  await page.getByRole("button", { name: "レポート", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "経済レポート" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    )
    .toBe(false);
});
