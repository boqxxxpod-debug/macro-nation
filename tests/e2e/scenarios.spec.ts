import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { GameState } from "@macro-nation/domain";
import { waitForPageLayout } from "./paging";

const EVIDENCE_DIRECTORY = resolve("artifacts/issue-117");
const SCENARIOS = [
  {
    id: "SCN-01",
    title: "小さな開放経済",
    difficulty: "intro",
    months: 48,
    slot: 1,
    seed: "first-playable-48",
  },
  {
    id: "SCN-02",
    title: "通貨安と輸入インフレ",
    difficulty: "standard",
    months: 96,
    slot: 2,
    seed: "issue-117-scn02-ui",
  },
  {
    id: "SCN-03",
    title: "関税応酬と供給制約",
    difficulty: "expert",
    months: 96,
    slot: 3,
    seed: "issue-117-scn03-ui",
  },
] as const;

interface SaveSummary {
  readonly scenarioId: string;
  readonly difficulty: string;
  readonly durationMode: string;
  readonly learningMode: string | undefined;
  readonly slotId: number;
  readonly monthIndex: number;
  readonly tickSequence: number;
  readonly runState: string;
  readonly rootSeed: string;
  readonly configHash: string;
  readonly scenario: { id: string; durationMonths: number };
  readonly endMonth: number | undefined;
  readonly progressionMode: string | undefined;
  readonly pendingEvent: string | undefined;
  readonly receipts: NonNullable<GameState["policyAdministration"]>["receipts"];
  readonly versions: GameState["versions"];
  readonly economy: GameState["economy"] | undefined;
}
interface Operation {
  readonly action: string;
  readonly scenarioId: string;
  readonly month: number;
  readonly runState: string;
  readonly detail?: string;
}

/** Inspect only states committed by real UI commands; never mutate browser storage. */
async function readSave(page: Page, slotId: number) {
  return page.evaluate(async (slotId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("macro-nation-games");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<SaveSummary>((resolve, reject) => {
        const request = database
          .transaction("slots", "readonly")
          .objectStore("slots")
          .get(slotId);
        request.onsuccess = () => {
          const state = request.result?.current as GameState | undefined;
          if (!state)
            return reject(new Error(`No UI-created save in slot ${slotId}`));
          const scenario = state.configSnapshot.normalizedConfig.scenario as {
            id: string;
            durationMonths: number;
          };
          resolve({
            scenarioId: state.scenarioId,
            difficulty: state.difficulty,
            durationMode: state.durationMode,
            learningMode: state.learningMode,
            slotId: state.slotId,
            monthIndex: state.monthIndex,
            tickSequence: state.tickSequence,
            runState: state.runState,
            rootSeed: state.rng.rootSeed,
            configHash: state.configSnapshot.configHash,
            scenario,
            endMonth: state.clock.endMonth,
            progressionMode: state.clock.progressionMode,
            pendingEvent: state.events.pendingChoiceEventId,
            receipts: state.policyAdministration?.receipts ?? [],
            versions: state.versions,
            economy: state.monthIndex === 0 ? state.economy : undefined,
          });
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, slotId);
}

async function reveal(page: Page, target: Locator) {
  await waitForPageLayout(page);
  if (await target.isVisible()) return;
  const previous = page.getByRole("button", { name: /の前のページ$/ });
  for (let count = 0; count < 300 && (await previous.isEnabled()); count++) {
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

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await waitForPageLayout(page);
  const path = resolve(EVIDENCE_DIRECTORY, `${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

function record(
  operations: Operation[],
  action: string,
  state: SaveSummary,
  detail?: string,
) {
  operations.push({
    action,
    scenarioId: state.scenarioId,
    month: state.monthIndex,
    runState: state.runState,
    ...(detail ? { detail } : {}),
  });
}

async function confirmPolicy(
  page: Page,
  scenario: (typeof SCENARIOS)[number],
  operations: Operation[],
  testInfo: TestInfo,
) {
  await page.getByRole("button", { name: "政策を考える", exact: true }).click();
  const kind = page.getByRole("combobox", { name: "政策の種類" });
  await reveal(page, kind);
  await kind.selectOption({
    label: scenario.id === "SCN-03" ? "関税" : "政策金利",
  });
  const value = page.getByRole("spinbutton", {
    name: scenario.id === "SCN-03" ? "関税率（%）" : "政策金利（年率・%）",
  });
  await reveal(page, value);
  await value.fill("5");
  await page.getByRole("button", { name: "見通しを確認" }).click();
  await expect(
    page.getByRole("heading", { name: "政策の見通し", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const confirm = page.getByRole("button", { name: "政策を確定する" });
  await expect(confirm).toBeDisabled();
  const acknowledge = page.getByRole("checkbox", {
    name: "費用・副作用・警告を確認しました",
  });
  await reveal(page, acknowledge);
  await acknowledge.check();
  await expect(confirm).toBeEnabled();
  await screenshot(page, testInfo, `${scenario.id}-policy-confirmation`);
  await confirm.click();
  await expect(page.getByRole("heading", { name: "国家ビュー" })).toBeVisible();
  await expect
    .poll(async () => (await readSave(page, scenario.slot)).receipts.length)
    .toBe(1);
  record(
    operations,
    "政策を確定する",
    await readSave(page, scenario.slot),
    `${scenario.id === "SCN-03" ? "関税" : "政策金利"}=5%`,
  );
  const guidance = page.getByRole("dialog", { name: "運営の案内" });
  if (await guidance.isVisible())
    await guidance.getByRole("button", { name: "詳細を閉じる" }).click();
}

async function runThroughUI(
  page: Page,
  scenario: (typeof SCENARIOS)[number],
  operations: Operation[],
  testInfo: TestInfo,
) {
  let state = await readSave(page, scenario.slot);
  const startHash = state.configHash;
  for (let command = 0; command < scenario.months * 4; command++) {
    if (state.runState === "completed" || state.runState === "failed") break;
    if (state.runState === "awaitingEvent") {
      const eventId = state.pendingEvent;
      await page.getByRole("button", { name: "イベントの対応を選ぶ" }).click();
      const choice = page.getByRole("button", {
        name: "バランスを取る",
        exact: true,
      });
      await reveal(page, choice);
      await screenshot(
        page,
        testInfo,
        `${scenario.id}-event-${state.monthIndex}`,
      );
      await choice.click();
      await expect(
        page.getByRole("heading", { name: "国家ビュー" }),
      ).toBeVisible();
      await expect
        .poll(async () => (await readSave(page, scenario.slot)).pendingEvent)
        .not.toBe(eventId);
      state = await readSave(page, scenario.slot);
      record(operations, "バランスを取る", state, eventId);
    } else if (state.runState === "crisisStopped") {
      await page.getByRole("button", { name: "緊急会議を開く" }).click();
      const resume = page.getByRole("button", {
        name: "危機対応を確認して再開",
      });
      await reveal(page, resume);
      await screenshot(
        page,
        testInfo,
        `${scenario.id}-crisis-${state.monthIndex}`,
      );
      await resume.click();
      await expect(
        page.getByRole("heading", { name: "国家ビュー" }),
      ).toBeVisible();
      await expect
        .poll(async () => (await readSave(page, scenario.slot)).runState)
        .not.toBe("crisisStopped");
      state = await readSave(page, scenario.slot);
      record(operations, "危機対応を確認して再開", state);
    } else {
      const previousMonth = state.monthIndex;
      const advance = page.getByRole("button", {
        name: "1か月進める",
        exact: true,
      });
      await expect(advance).toBeEnabled();
      await advance.click();
      await expect
        .poll(async () => (await readSave(page, scenario.slot)).monthIndex)
        .toBe(previousMonth + 1);
      state = await readSave(page, scenario.slot);
      record(operations, "1か月進める", state);
    }
    expect(state.configHash).toBe(startHash);
    expect(state.scenarioId).toBe(scenario.id);
    expect(state.rootSeed).toBe(scenario.seed);
    expect(state.progressionMode).toBe("manual");
    expect(state.monthIndex).toBeLessThanOrEqual(scenario.months);
  }
  expect(["completed", "failed"]).toContain(state.runState);
  if (state.runState === "completed")
    expect(state.monthIndex).toBe(scenario.months);
  if (scenario.id === "SCN-01") {
    expect(state.runState).toBe("completed");
    expect(state.monthIndex).toBe(48);
  }
  // The final tick may navigate directly to the ending; the nation view also
  // offers a player-visible entry when loading a run that already ended.
  if (
    !(await page
      .getByRole("heading", { name: "終了評価", exact: true })
      .isVisible())
  ) {
    await expect(
      page.getByRole("button", { name: "1か月進める", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "終了評価を見る", exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "終了評価", exact: true }),
  ).toBeVisible();
  const score = page.getByRole("heading", { name: /総合評価：/ }).first();
  await reveal(page, score);
  await expect(score).toBeVisible();
  await screenshot(page, testInfo, `${scenario.id}-ending`);
  return state;
}

test("a fresh device shows the scenario challenges and locks the standard scenarios", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.goto("/");
  const selection = page.getByRole("combobox", {
    name: "シナリオ",
    exact: true,
  });
  await reveal(page, selection);
  await expect(selection).toHaveValue("SCN-01");
  for (const scenario of SCENARIOS.slice(1)) {
    await expect(
      selection.locator(`option[value="${scenario.id}"]`),
    ).toHaveAttribute("disabled", "");
  }
  await screenshot(page, testInfo, "locked-scenario-selection-mobile");
  for (const scenario of SCENARIOS.slice(1)) {
    const title = page
      .getByRole("heading", {
        name: scenario.title,
        exact: true,
      })
      .first();
    await reveal(page, title);
    await expect(title).toBeVisible();
  }
  const condition = page
    .getByText(
      "解放条件：小さな開放経済を予定期間の最後まで完了してください。",
      { exact: true },
    )
    .first();
  await reveal(page, condition);
  await expect(condition).toBeVisible();
});

test("UI completion unlocks both standard scenarios across reload and all three reach an ending", async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const operations: Operation[] = [];
  const initialStates: SaveSummary[] = [];
  const endings: SaveSummary[] = [];
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  try {
    await page.goto("/");
    // Repository loading finishes after navigation; measure the mounted deck.
    await expect(
      page.getByRole("region", { name: "開始設定", exact: true }),
    ).toBeVisible();
    for (const scenario of SCENARIOS) {
      const slot = page.getByRole("button", {
        name: `保存先${scenario.slot}ではじめる`,
      });
      await reveal(page, slot);
      await slot.click();
      const selection = page.getByRole("combobox", {
        name: "シナリオ",
        exact: true,
      });
      await reveal(page, selection);
      await expect(
        selection.locator(`option[value="${scenario.id}"]`),
      ).not.toHaveAttribute("disabled");
      await selection.selectOption(scenario.id);
      const duration = page.getByRole("radio", {
        name: new RegExp(`${scenario.months / 12}年（${scenario.months}か月）`),
      });
      await reveal(page, duration);
      await expect(duration).toBeChecked();
      const difficulty = page.getByRole("combobox", {
        name: "難易度",
        exact: true,
      });
      await reveal(page, difficulty);
      await difficulty.selectOption(scenario.difficulty);
      const learning = page.getByRole("combobox", {
        name: "説明モード",
        exact: true,
      });
      await reveal(page, learning);
      await learning.selectOption("casual");
      const seed = page.getByRole("textbox", { name: "再現用コード（任意）" });
      await reveal(page, seed);
      await seed.fill(scenario.seed);
      await screenshot(page, testInfo, `${scenario.id}-start-settings`);
      await page.getByRole("button", { name: "はじめる", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "国家ビュー" }),
      ).toBeVisible();
      const initial = await readSave(page, scenario.slot);
      expect(initial).toMatchObject({
        scenarioId: scenario.id,
        difficulty: scenario.difficulty,
        rootSeed: scenario.seed,
        slotId: scenario.slot,
        monthIndex: 0,
        endMonth: scenario.months,
        learningMode: "casual",
        progressionMode: "manual",
      });
      expect(initial.scenario.id).toBe(scenario.id);
      expect(initial.scenario.durationMonths).toBe(scenario.months);
      initialStates.push(initial);
      record(
        operations,
        "はじめる",
        initial,
        `${scenario.difficulty}, ${scenario.months}か月, seed=${scenario.seed}`,
      );
      if (scenario.id !== "SCN-01")
        await confirmPolicy(page, scenario, operations, testInfo);
      endings.push(await runThroughUI(page, scenario, operations, testInfo));
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "終了評価", exact: true }),
      ).toBeVisible();
      const reloaded = await readSave(page, scenario.slot);
      expect(reloaded.monthIndex).toBe(endings.at(-1)!.monthIndex);
      expect(reloaded.runState).toBe(endings.at(-1)!.runState);
      expect(reloaded.configHash).toBe(initial.configHash);
      await page.getByRole("button", { name: "メニュー", exact: true }).click();
      const slots = page.getByRole("button", {
        name: "はじめる・続きから",
        exact: true,
      });
      await reveal(page, slots);
      await slots.click();
      await expect(
        page.getByRole("heading", { name: "はじめる・続きから", exact: true }),
      ).toBeVisible();
      await reveal(
        page,
        page.getByRole("combobox", { name: "シナリオ", exact: true }),
      );
      for (const unlocked of SCENARIOS.slice(1))
        await expect(
          page
            .getByRole("combobox", { name: "シナリオ", exact: true })
            .locator(`option[value="${unlocked.id}"]`),
        ).not.toHaveAttribute("disabled");
      await screenshot(page, testInfo, `${scenario.id}-unlocked-after-reload`);
    }
    expect(new Set(initialStates.map((state) => state.configHash)).size).toBe(
      3,
    );
    expect(browserErrors).toEqual([]);
  } finally {
    const path = resolve(EVIDENCE_DIRECTORY, "ui-operation-log.json");
    await writeFile(
      path,
      JSON.stringify(
        {
          method:
            "All starts, policies, monthly ticks, event choices and crisis resumes use normal UI controls. IndexedDB access is read-only. No injected state or skipped months.",
          initialStates,
          endings,
          operations,
          browserErrors,
        },
        null,
        2,
      ),
    );
    await testInfo.attach("ui-operation-log", {
      path,
      contentType: "application/json",
    });
  }
});
