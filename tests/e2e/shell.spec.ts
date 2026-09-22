import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("360px PWA shell renders and remains available offline after first load", async ({
  context,
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "MACRO NATION" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "MACRO NATION" })).toBeVisible();

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "MACRO NATION" })).toBeVisible();
});

test("foundation shell has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/");

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );

  expect(blocking).toEqual([]);
});
