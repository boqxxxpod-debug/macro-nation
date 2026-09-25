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
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "ゲームを始める" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeFocused();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
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
