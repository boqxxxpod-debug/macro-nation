import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForPageLayout } from "./paging";

test.setTimeout(120_000);

async function reveal(page: Page, target: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const previous = page.getByRole("button", { name: /：前のページ$/ });
  for (let count = 0; count < 500 && (await previous.isEnabled()); count++) {
    await previous.click();
    await waitForPageLayout(page);
  }
  const next = page.getByRole("button", { name: /：次のページ$/ });
  for (let count = 0; count < 500; count++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  await expect(target).toBeVisible();
}

async function acknowledgeCosts(page: Page) {
  const checkbox = page.getByRole("checkbox", {
    name: "費用・副作用・警告を確認しました",
  });
  await reveal(page, checkbox);
  await checkbox.check();
}

test("360px PWA shell renders and remains available offline after first load", async ({
  context,
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "MACRO NATION" }),
  ).toBeVisible();
  await reveal(page, page.getByRole("button", { name: "保存履歴" }));
  await page.getByRole("button", { name: "保存履歴" }).click();
  await reveal(page, page.getByText("保存された国家運営はまだありません。"));
  await expect(
    page.getByText("保存された国家運営はまだありません。"),
  ).toBeVisible();
  await reveal(page, page.getByRole("button", { name: "遊び方・設定" }));
  await page.getByRole("button", { name: "遊び方・設定" }).click();
  await reveal(page, page.getByText(/ログインや通信を必要としません/));

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

test("mobile policy journey rejects a duplicate confirmation and persists through reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
  await page.getByRole("button", { name: "政策を考える" }).click();
  await reveal(
    page,
    page.getByRole("spinbutton", { name: "政策金利の設定値" }),
  );
  await page.getByRole("spinbutton", { name: "政策金利の設定値" }).fill("0.05");
  await page.getByRole("button", { name: "1年・5年を比較する" }).click();
  await expect(
    page.getByRole("heading", { name: "政策プレビュー" }),
  ).toBeFocused();
  await reveal(
    page,
    page.getByRole("heading", { name: "無追加政策との12か月比較" }).first(),
  );
  await acknowledgeCosts(page);
  // A rapid double tap must still create exactly one durable decision.
  await page.getByRole("button", { name: "政策を確定して保存" }).dblclick();
  await expect(
    page.getByText("政策を確定し、端末に保存しました。"),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await page.getByRole("button", { name: "政策会議", exact: true }).click();
  // One of the three quarterly slots was consumed; the duplicate was ignored.
  await expect(page.getByText(/残り 2 \/ 3枠/)).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await page.getByRole("button", { name: "1か月進める" }).click();
  await page
    .getByRole("combobox", { name: "ホームの詳細" })
    .selectOption({ label: "今月の報告" });
  await reveal(
    page,
    page.getByRole("heading", { name: "今月の3行報告" }).first(),
  );
  await page.getByRole("button", { name: "理由を見る" }).click();
  await reveal(page, page.getByRole("heading", { name: "なぜ起きた" }).first());
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
  await reveal(page, page.getByRole("combobox", { name: "説明モード" }));
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(page.locator(".app-shell")).toHaveClass(/enlarged-text/);
  await expect(page.locator("[data-page-deck]")).toHaveClass(
    /page-deck-expanded/,
  );
  await expect(page.locator("[data-page-item][inert]")).toHaveCount(0);
  await reveal(page, page.getByRole("radio", { name: /30年/ }));
  await page.getByRole("radio", { name: /30年/ }).focus();
  await expect(page.getByRole("radio", { name: /30年/ })).toBeFocused();
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
  await reveal(
    page,
    page.getByRole("button", { name: "スロット2で新しく始める" }),
  );
  await page.getByRole("button", { name: "スロット2で新しく始める" }).click();
  await reveal(page, page.getByRole("combobox", { name: "難易度" }));
  await page.getByRole("combobox", { name: "難易度" }).selectOption("expert");
  await reveal(page, page.getByRole("radio", { name: /20年/ }));
  await page.getByRole("radio", { name: /20年/ }).check();
  await reveal(page, page.getByRole("combobox", { name: "説明モード" }));
  await page
    .getByRole("combobox", { name: "説明モード" })
    .selectOption("casual");
  await reveal(page, page.getByRole("textbox", { name: "再現用seed（任意）" }));
  await page
    .getByRole("textbox", { name: "再現用seed（任意）" })
    .fill("issue-17-seed");
  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await expect(
    page.getByText("ゲームを開始し、端末に保存しました。"),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await reveal(page, page.getByRole("button", { name: "保存スロット" }));
  await page.getByRole("button", { name: "保存スロット" }).click();
  await reveal(page, page.getByText(/20年・240か月・expert・casual/));
  await reveal(page, page.getByRole("button", { name: "スロット2の続きから" }));
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
  await reveal(page, page.getByRole("textbox", { name: "再現用seed（任意）" }));
  await page
    .getByRole("textbox", { name: "再現用seed（任意）" })
    .fill("first-playable-48");
  await page.getByRole("button", { name: "ゲームを始める" }).click();
  await page
    .getByRole("combobox", { name: "ホームの詳細" })
    .selectOption({ label: "チュートリアル" });
  await reveal(
    page,
    page.getByRole("heading", { name: "はじめの4四半期・第1回" }).first(),
  );
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
  await reveal(page, page.getByText("48か月の運営が完了しました。"));
  await reveal(page, page.getByRole("heading", { name: /総合評価/ }).first());
  await page.reload();
  await reveal(
    page,
    page.getByRole("heading", { name: "最も大きな変化と原因" }).first(),
  );
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
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "1か月進める" }).click();
  await page
    .getByRole("combobox", { name: "ホームの詳細" })
    .selectOption({ label: "今月の報告" });
  await reveal(
    page,
    page.getByRole("heading", { name: "今月の3行報告" }).first(),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await page
    .getByRole("combobox", { name: "ホームの詳細" })
    .selectOption({ label: "今月の報告" });
  await reveal(
    page,
    page.getByRole("heading", { name: "今月の3行報告" }).first(),
  );
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
  await expect(page.locator("img.nation-landscape")).toHaveJSProperty(
    "naturalWidth",
    941,
  );
  await expect(page.getByRole("button", { name: /港湾を選択/ })).toBeVisible();
  await page.getByRole("button", { name: /港湾を選択/ }).click();
  await reveal(page, page.getByText(/輸出（月間）/).first());
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  const details = page.getByRole("combobox", { name: "詳細の表示" });
  await details.focus();
  await details.selectOption("regions");
  const harbor = page.getByRole("button", { name: /港湾 安定/ });
  await reveal(page, harbor);
  await harbor.click();
  await reveal(page, page.getByText(/輸出（月間）/).first());
  await details.focus();
  await details.selectOption("settings");
  await waitForPageLayout(page);
  await expect(page.getByText("動きの軽減: 静止表示")).toBeVisible();
  await page.getByRole("button", { name: "詳細を閉じる" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "地域一覧", exact: true }),
  ).toBeVisible();
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
