import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { waitForPageLayout, waitForEnlargedText } from "./paging";
import type { GameState } from "../../packages/domain/src/index";

const INITIAL_TIME = new Date("2026-10-02T12:00:00Z");

async function freezeClock(page: Page) {
  await page.clock.install({ time: INITIAL_TIME });
  await page.clock.setFixedTime(new Date(INITIAL_TIME.getTime() + 1_000));
}

async function advanceTime(page: Page, milliseconds: number) {
  const current = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(current + milliseconds));
  await page.clock.fastForward(1_000);
}

async function reveal(page: Page, target: ReturnType<Page["getByRole"]>) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const previous = page.getByRole("button", { name: /の前のページ$/ });
  while (await previous.isEnabled()) {
    await previous.click();
    await waitForPageLayout(page);
  }
  const next = page.getByRole("button", { name: /の次のページ$/ });
  for (let count = 0; count < 300; count++) {
    if (await target.isVisible()) return;
    if (!(await next.isEnabled())) break;
    await next.click();
    await waitForPageLayout(page);
  }
  await expect(target).toBeVisible();
}

async function startGame(page: Page) {
  await page.goto("/");
  await reveal(page, page.getByRole("combobox", { name: "説明モード" }));
  await page
    .getByRole("combobox", { name: "説明モード" })
    .selectOption("casual");
  await reveal(
    page,
    page.getByRole("textbox", { name: "再現用コード（任意）" }),
  );
  await page
    .getByRole("textbox", { name: "再現用コード（任意）" })
    .fill("first-playable-48");
  await page.getByRole("button", { name: "はじめる", exact: true }).click();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
}

function controls(page: Page) {
  return page.getByRole("region", { name: "時間の進行" });
}

async function startAuto(page: Page) {
  await controls(page)
    .getByRole("combobox", { name: "時間の進め方" })
    .selectOption("auto");
  await controls(page)
    .getByRole("button", { name: "自動進行を始める" })
    .click();
  await expect
    .poll(async () => (await readSave(page)).runState)
    .toBe("running");
}

async function previewInterestRatePolicy(page: Page) {
  const value = page.getByRole("spinbutton", {
    name: "政策金利（年率・%）",
  });
  await reveal(page, value);
  await value.fill("5");
  await page.getByRole("button", { name: "見通しを確認" }).click();
  await expect(
    page.getByRole("heading", { name: "政策の見通し" }),
  ).toBeVisible();
}

async function confirmPolicy(page: Page) {
  const acknowledge = page.getByRole("checkbox", {
    name: "費用・副作用・警告を確認しました",
  });
  await reveal(page, acknowledge);
  await acknowledge.check();
  await page.getByRole("button", { name: "政策を確定する" }).click();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await expect(
    page.getByText("政策を確定し、端末に保存しました。"),
  ).toBeAttached();
}

async function expectConfirmedPolicy(
  page: Page,
  mode: "manual" | "auto",
  status: "reserved" | "active" = "reserved",
) {
  await expect(
    page.getByRole("combobox", { name: "ホームの詳細" }),
  ).toHaveValue("policy");
  const setting = page.getByText("政策金利。政策金利（年率・%）：5%。", {
    exact: true,
  });
  await reveal(page, setting);
  await expect(setting).toBeVisible();
  const lifecycle = page.getByText(
    status === "reserved"
      ? "開始予定：1月目。状態：開始待ち（予約中）。"
      : "開始月：1月目。状態：実施中。",
    { exact: true },
  );
  await reveal(page, lifecycle);
  await expect(lifecycle).toBeVisible();
  if (status === "reserved") {
    const waiting = page.getByText(/確定した時点では発動していません/);
    await reveal(page, waiting);
    await expect(waiting).toBeVisible();
  }
  const guidance = page.getByText(
    mode === "manual"
      ? /「1か月進める」で月を進めてください/
      : status === "reserved"
        ? /時間の進行で「再開」/
        : /自動進行中です/,
  );
  await reveal(page, guidance);
  await expect(guidance).toBeVisible();
  if (mode === "auto" && status === "reserved")
    await expect(page.locator("#home-details")).toContainText(
      "政策の確定や再読込だけでは進みません。",
    );
  const report = page.getByRole("button", { name: "レポートで結果を見る" });
  await reveal(page, report);
  await expect(report).toBeVisible();
}

async function expectShellClock(page: Page, status: string) {
  await expect(page.locator(".game-view > .eyebrow")).toContainText(status);
  await expect(page.locator(".game-view > .eyebrow")).not.toContainText(
    "運営中",
  );
}

async function captureConfirmedPolicy(
  page: Page,
  mode: "manual" | "auto",
  testInfo: TestInfo,
) {
  await reveal(
    page,
    page.getByText("政策金利。政策金利（年率・%）：5%。", { exact: true }),
  );
  await page.screenshot({
    path: testInfo.outputPath(`policy-confirmed-${mode}-360x800.png`),
    fullPage: false,
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await waitForEnlargedText(page);
  await expectConfirmedPolicy(page, mode);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath(`policy-confirmed-${mode}-text200.png`),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await expect(page.locator(".app-shell")).not.toHaveClass(/\benlarged-text\b/);
  await waitForPageLayout(page);
}

// These fixtures exercise the production IndexedDB adapter through page reload.
// Only blocker setup bypasses commands; all progression and responses use the UI.
async function readSave(page: Page): Promise<GameState> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("macro-nation-games", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<GameState>((resolve, reject) => {
        const request = database
          .transaction("slots", "readonly")
          .objectStore("slots")
          .get(1);
        request.onsuccess = () => {
          if (!request.result?.current)
            reject(new Error("No saved game in slot 1"));
          else resolve(request.result.current as GameState);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

async function writeSave(page: Page, state: GameState) {
  await page.evaluate(async (next) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("macro-nation-games", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("slots", "readwrite");
        transaction.objectStore("slots").put({ slotId: 1, current: next });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, state);
}

async function setVisibility(page: Page, visibility: "hidden" | "visible") {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => next,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => next === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibility);
}

test("automatic months follow the saved clock across views, pauses, and reload", async ({
  page,
}) => {
  await freezeClock(page);
  await startGame(page);
  await expect(
    controls(page).getByRole("combobox", { name: "時間の進め方" }),
  ).toHaveValue("manual");
  const stepMs = (await readSave(page)).clock.config.realSecondsPerStep * 1_000;
  await advanceTime(page, stepMs * 2);
  await page.reload();
  expect((await readSave(page)).monthIndex).toBe(0);

  await page.getByRole("button", { name: "国家ビュー", exact: true }).click();
  await controls(page)
    .getByRole("combobox", { name: "時間の進め方" })
    .selectOption("auto");
  await advanceTime(page, stepMs);
  expect((await readSave(page)).monthIndex).toBe(0);
  await expect(controls(page).getByLabel("次の月までの残り時間")).toContainText(
    "5:00",
  );
  await controls(page)
    .getByRole("button", { name: "自動進行を始める" })
    .click();
  await expect
    .poll(async () => (await readSave(page)).runState)
    .toBe("running");
  await expect(
    controls(page).getByRole("button", { name: "1か月進める" }),
  ).toBeDisabled();
  await advanceTime(page, stepMs - 1_000);
  expect((await readSave(page)).monthIndex).toBe(0);
  await expect(controls(page).getByLabel("次の月までの残り時間")).toContainText(
    "0:01",
  );
  await advanceTime(page, 1_000);
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(1);
  await expect(controls(page)).toContainText("進行中");
  await expect(controls(page)).toContainText("1年目 2月");

  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page
    .getByRole("combobox", { name: "ホームの詳細" })
    .selectOption("report");
  await reveal(
    page,
    page.getByRole("heading", { name: "今月の3行報告" }).first(),
  );
  await advanceTime(page, 120_000);
  await controls(page)
    .getByRole("button", { name: "一時停止", exact: true })
    .click();
  await expect.poll(async () => (await readSave(page)).runState).toBe("paused");
  expect((await readSave(page)).clock.remainderMs).toBe(120_000);
  await advanceTime(page, stepMs * 4);
  await page.reload();
  await expect(controls(page)).toContainText("停止中");
  expect((await readSave(page)).monthIndex).toBe(1);
  await controls(page)
    .getByRole("button", { name: "再開", exact: true })
    .click();
  await expect
    .poll(async () => (await readSave(page)).runState)
    .toBe("running");
  await advanceTime(page, stepMs - 120_000 - 1_000);
  expect((await readSave(page)).monthIndex).toBe(1);
  await advanceTime(page, 1_000);
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(2);
  expect((await readSave(page)).tickSequence).toBe(2);
  await controls(page)
    .getByRole("combobox", { name: "時間の進め方" })
    .selectOption("manual");
  await expect
    .poll(async () => (await readSave(page)).clock.progressionMode)
    .toBe("manual");
  await advanceTime(page, stepMs * 2);
  expect((await readSave(page)).monthIndex).toBe(2);
  await controls(page).getByRole("button", { name: "1か月進める" }).click();
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(3);
});

test("policy editing, preview, confirmation, and reload require an explicit resume", async ({
  page,
}, testInfo) => {
  await freezeClock(page);
  await startGame(page);
  await page.getByRole("button", { name: "国家ビュー", exact: true }).click();
  await startAuto(page);
  await advanceTime(page, 120_000);
  await page.getByRole("button", { name: "政策会議", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "政策会議", exact: true }),
  ).toBeVisible();
  expect((await readSave(page)).runState).toBe("paused");
  expect((await readSave(page)).clock.stopReason).toBe("policy");
  await expectShellClock(page, "自動・停止中 · 政策会議で停止");
  await advanceTime(page, 600_000);
  expect((await readSave(page)).monthIndex).toBe(0);
  await previewInterestRatePolicy(page);
  await expectShellClock(page, "自動・停止中 · 政策会議で停止");
  await advanceTime(page, 600_000);
  expect((await readSave(page)).monthIndex).toBe(0);
  await confirmPolicy(page);
  await expectConfirmedPolicy(page, "auto");
  await expect(controls(page).getByRole("status")).toHaveText(
    "停止中 · 政策会議で停止",
  );
  await expect(
    controls(page).getByRole("button", { name: "再開", exact: true }),
  ).toBeEnabled();
  const confirmed = await readSave(page);
  expect(confirmed.policies.reserved[0]?.inputs.value).toBe(0.05);
  expect(confirmed.policyAdministration?.receipts).toHaveLength(1);
  await page.getByRole("button", { name: "レポートで結果を見る" }).click();
  await expect(
    page.getByRole("heading", { name: "経済レポート" }),
  ).toBeVisible();
  await expectShellClock(page, "自動・停止中 · 政策会議で停止");
  await page.getByRole("button", { name: "政策会議", exact: true }).click();
  await expectShellClock(page, "自動・停止中 · 政策会議で停止");
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await advanceTime(page, 600_000);
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await expectConfirmedPolicy(page, "auto");
  await expect(controls(page).getByRole("status")).toHaveText(
    "停止中 · 政策会議で停止",
  );
  await captureConfirmedPolicy(page, "auto", testInfo);
  expect(await readSave(page)).toEqual(confirmed);
  await controls(page)
    .getByRole("button", { name: "再開", exact: true })
    .click();
  await expect
    .poll(async () => (await readSave(page)).runState)
    .toBe("running");
  await advanceTime(page, 180_000);
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(1);
  const activated = await readSave(page);
  expect(activated.tickSequence).toBe(1);
  expect(activated.policies.reserved).toHaveLength(0);
  expect(activated.policies.active[0]?.policyId).toBe(
    confirmed.policies.reserved[0]?.policyId,
  );
  expect(activated.policyAdministration?.receipts).toHaveLength(1);
  await expectConfirmedPolicy(page, "auto", "active");
  await advanceTime(page, 0);
  expect((await readSave(page)).tickSequence).toBe(1);
});

test("manual policy confirmation survives reload and guides the next month and report", async ({
  page,
}, testInfo) => {
  await freezeClock(page);
  await startGame(page);
  await page.getByRole("button", { name: "政策会議", exact: true }).click();
  await expectShellClock(page, "手動・停止中 · 操作待ち");
  await previewInterestRatePolicy(page);
  await expectShellClock(page, "手動・停止中 · 政策会議で停止");
  await confirmPolicy(page);
  await expectConfirmedPolicy(page, "manual");
  await expect(controls(page).getByRole("status")).toHaveText(
    "停止中 · 政策会議で停止",
  );
  const confirmed = await readSave(page);
  expect(confirmed.monthIndex).toBe(0);
  expect(confirmed.policies.reserved[0]?.inputs.value).toBe(0.05);
  expect(confirmed.policyAdministration?.receipts).toHaveLength(1);
  const stepMs = confirmed.clock.config.realSecondsPerStep * 1_000;
  await advanceTime(page, stepMs * 3);
  await page.reload();
  await expect(page.getByRole("heading", { name: "国家ホーム" })).toBeVisible();
  await expectConfirmedPolicy(page, "manual");
  expect(await readSave(page)).toEqual(confirmed);
  await captureConfirmedPolicy(page, "manual", testInfo);
  expect(await readSave(page)).toEqual(confirmed);
  await controls(page).getByRole("button", { name: "1か月進める" }).click();
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(1);
  const activated = await readSave(page);
  expect(activated.tickSequence).toBe(1);
  expect(activated.runState).toBe("paused");
  expect(activated.policies.reserved).toHaveLength(0);
  expect(activated.policies.active[0]?.policyId).toBe(
    confirmed.policies.reserved[0]?.policyId,
  );
  expect(activated.policyAdministration?.receipts).toHaveLength(1);
  await expectConfirmedPolicy(page, "manual", "active");
  await page.getByRole("button", { name: "レポートで結果を見る" }).click();
  await expect(
    page.getByRole("heading", { name: "経済レポート" }),
  ).toBeVisible();
  await expectShellClock(page, "手動・停止中 · 操作待ち");
  expect(await readSave(page)).toEqual(activated);
});

test("an event blocks the clock and its choice stays paused until explicit resume", async ({
  page,
}) => {
  await freezeClock(page);
  await startGame(page);
  const state = await readSave(page);
  await writeSave(page, {
    ...state,
    runState: "awaitingEvent",
    clock: {
      ...state.clock,
      progressionMode: "auto",
      lastProcessedWallClockMs: null,
      remainderMs: 0,
      stopReason: "event",
    },
    events: {
      ...state.events,
      activeEventIds: ["evt-demand-slump"],
      pendingChoiceEventId: "evt-demand-slump",
      occurrences: [
        {
          eventId: "evt-demand-slump",
          occurredMonth: 0,
          preparedness: 0.5,
          baselineDamage: -2,
          preparednessMitigation: 0.5,
          choiceMitigation: 0,
          targetPath: "economy.indices.realGdp",
        },
      ],
    },
  });
  await page.reload();
  await expect(controls(page)).toContainText("イベントの選択待ち");
  await expect(
    controls(page).getByRole("button", { name: "再開", exact: true }),
  ).toBeDisabled();
  await advanceTime(page, 600_000);
  expect((await readSave(page)).monthIndex).toBe(0);
  await reveal(
    page,
    page.getByRole("button", { name: "バランスを取る", exact: true }),
  );
  await page
    .getByRole("button", { name: "バランスを取る", exact: true })
    .click();
  await expect(page.getByText("イベント対応を保存しました。")).toBeAttached();
  await expect(controls(page)).toContainText("停止中");
  await advanceTime(page, 600_000);
  expect((await readSave(page)).monthIndex).toBe(0);
  await controls(page)
    .getByRole("button", { name: "再開", exact: true })
    .click();
  await expect
    .poll(async () => (await readSave(page)).runState)
    .toBe("running");
  await advanceTime(page, state.clock.config.realSecondsPerStep * 1_000);
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(1);
});

test("a crisis needs the existing emergency response before automatic resume", async ({
  page,
}) => {
  await freezeClock(page);
  await startGame(page);
  const state = await readSave(page);
  await writeSave(page, {
    ...state,
    runState: "crisisStopped",
    clock: {
      ...state.clock,
      progressionMode: "auto",
      lastProcessedWallClockMs: null,
      remainderMs: 0,
      stopReason: "crisis",
    },
  });
  await page.reload();
  await expect(controls(page)).toContainText("危機への対応待ち");
  await expect(
    controls(page).getByRole("button", { name: "再開", exact: true }),
  ).toBeDisabled();
  await advanceTime(page, 600_000);
  expect((await readSave(page)).monthIndex).toBe(0);
  await reveal(
    page,
    page.getByRole("button", { name: "危機対応を確認して再開", exact: true }),
  );
  await page
    .getByRole("button", { name: "危機対応を確認して再開", exact: true })
    .click();
  await expect(
    page.getByText("危機対応を保存し、再開できる状態になりました。"),
  ).toBeAttached();
  await expect(controls(page)).toContainText("停止中");
  await advanceTime(page, 600_000);
  expect((await readSave(page)).monthIndex).toBe(0);
  await controls(page)
    .getByRole("button", { name: "再開", exact: true })
    .click();
  await expect
    .poll(async () => (await readSave(page)).runState)
    .toBe("running");
  await advanceTime(page, state.clock.config.realSecondsPerStep * 1_000);
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(1);
});

test("the final automatic month stops at the ending and cannot advance beyond it", async ({
  page,
}) => {
  await freezeClock(page);
  await startGame(page);
  const state = await readSave(page);
  await writeSave(page, {
    ...state,
    monthIndex: 47,
    tickSequence: 47,
    clock: {
      ...state.clock,
      stepIndex: 47,
      year: state.clock.year + 3,
      month: 12,
      progressionMode: "auto",
      lastProcessedWallClockMs: null,
      remainderMs: 0,
      stopReason: "manual",
    },
  });
  await page.reload();
  await controls(page)
    .getByRole("button", { name: "再開", exact: true })
    .click();
  await expect
    .poll(async () => (await readSave(page)).runState)
    .toBe("running");
  await advanceTime(page, state.clock.config.realSecondsPerStep * 1_000);
  await expect(
    page.getByRole("heading", { name: "終了評価", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await readSave(page)).runState)
    .toBe("completed");
  await advanceTime(page, 3_000_000);
  await page.reload();
  expect((await readSave(page)).monthIndex).toBe(48);
  expect((await readSave(page)).tickSequence).toBe(48);
});

test("hidden time is caught up once, preserving the fraction through an offline reload", async ({
  context,
  page,
}) => {
  const workerUrls: string[] = [];
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  await freezeClock(page);
  await startGame(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await startAuto(page);
  await advanceTime(page, 120_000);
  await setVisibility(page, "hidden");
  await advanceTime(page, 600_000);
  expect((await readSave(page)).monthIndex).toBe(0);
  await setVisibility(page, "visible");
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(2);
  await reveal(page, page.getByText(/2か月を反映しました/));
  await expect(page.getByRole("region", { name: "帰還報告" })).toContainText(
    "2か月を反映しました",
  );
  expect(workerUrls.some((url) => url.includes("offline-month.worker"))).toBe(
    true,
  );
  await page.getByRole("button", { name: "詳細を閉じる" }).click();
  expect((await readSave(page)).clock.remainderMs).toBe(120_000);
  await setVisibility(page, "hidden");
  await advanceTime(page, 180_000);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(3);
  await reveal(page, page.getByText(/1か月を反映しました/));
  await expect(page.getByRole("region", { name: "帰還報告" })).toContainText(
    "1か月を反映しました",
  );
  await page.getByRole("button", { name: "詳細を閉じる" }).click();
  expect((await readSave(page)).clock.remainderMs).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(controls(page)).toContainText("進行中");
  expect((await readSave(page)).monthIndex).toBe(3);
  expect((await readSave(page)).tickSequence).toBe(3);
});

test("360px and 200% text retain keyboard access to automatic time controls", async ({
  page,
}, testInfo) => {
  await freezeClock(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startGame(page);
  await page.getByRole("button", { name: "国家ビュー", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await waitForEnlargedText(page);
  const mode = controls(page).getByRole("combobox", { name: "時間の進め方" });
  await mode.focus();
  await page.keyboard.press("End");
  await expect(mode).toHaveValue("auto");
  await controls(page)
    .getByRole("button", { name: "自動進行を始める" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    controls(page).getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  await controls(page)
    .getByRole("button", { name: "一時停止", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    controls(page).getByRole("button", { name: "再開", exact: true }),
  ).toBeVisible();
  await expect(controls(page).getByLabel("次の月までの残り時間")).toBeVisible();
  const overflowing = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          element.scrollWidth > element.clientWidth ||
          element.getBoundingClientRect().right > innerWidth,
      )
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className),
        right: element.getBoundingClientRect().right,
        scroll: element.scrollWidth,
        client: element.clientWidth,
      })),
  }));
  await page.screenshot({
    path: testInfo.outputPath("nation-200-percent.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    JSON.stringify(overflowing),
  ).toBe(false);
});

test("a backward device clock saves recovery guidance without earning a month", async ({
  page,
}) => {
  await freezeClock(page);
  await startGame(page);
  const state = await readSave(page);
  const stepMs = state.clock.config.realSecondsPerStep * 1_000;
  const now = await page.evaluate(() => Date.now());
  await writeSave(page, {
    ...state,
    runState: "running",
    clock: {
      ...state.clock,
      progressionMode: "auto",
      lastProcessedWallClockMs: now + stepMs,
      remainderMs: 0,
    },
  });
  await page.reload();
  await expect(controls(page)).toContainText("端末の時刻が保存時より前");
  await expect
    .poll(async () => (await readSave(page)).clock.warning)
    .toBe("CLOCK_MOVED_BACKWARD");
  expect((await readSave(page)).monthIndex).toBe(0);
  await controls(page)
    .getByRole("button", { name: "一時停止", exact: true })
    .click();
  await controls(page)
    .getByRole("button", { name: "再開", exact: true })
    .click();
  await expect(controls(page)).not.toContainText("端末の時刻が保存時より前");
  expect((await readSave(page)).clock.warning).toBeUndefined();
  await advanceTime(page, stepMs);
  await expect.poll(async () => (await readSave(page)).monthIndex).toBe(1);
});
