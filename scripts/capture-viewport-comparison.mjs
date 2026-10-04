import { execFile } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "artifacts/issue-89");
const scratch = await mkdtemp(path.join(tmpdir(), "macro-nation-viewport-"));
const baseline = path.join(scratch, "before");
const servers = [];
const results = [];
let browser;
let worktreeCreated = false;
let baseCommit;
let failure;

async function run(command, args, cwd = root, env = process.env) {
  const result = await execute(command, args, {
    cwd,
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout.trim();
}

async function build(project) {
  await run(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      path.join(project, "apps/web/vite.config.ts"),
    ],
    path.join(project, "apps/web"),
    {
      ...process.env,
      VITE_BASE_PATH: "/",
      VITE_AI_ENABLED: "false",
    },
  );
}

async function serve(directory) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".png": "image/png",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
      let target = path.resolve(directory, "." + pathname);
      if (!target.startsWith(directory + path.sep) && target !== directory) {
        response.writeHead(403).end();
        return;
      }
      if (!path.extname(target) || pathname.endsWith("/"))
        target = path.join(directory, "index.html");
      const body = await readFile(target);
      response.writeHead(200, {
        "Content-Type":
          types[path.extname(target)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}/`;
}

async function settleDeck(page) {
  await page.evaluate(async () => {
    await globalThis.document.fonts.ready;
    await new Promise((resolve, reject) => {
      const started = globalThis.performance.now();
      let previous;
      let stableFrames = 0;
      function frame() {
        const deck = [
          ...globalThis.document.querySelectorAll("[data-page-deck]"),
        ].find(
          (element) =>
            !element.closest("[hidden], [inert]") &&
            element.getClientRects().length > 0,
        );
        const content = deck?.querySelector("[data-page-current]");
        const snapshot = content
          ? JSON.stringify({
              width: content.clientWidth,
              height: content.clientHeight,
              current: content.getAttribute("data-page-current"),
              status: deck.querySelector(".page-controls [role='status']")
                ?.textContent,
              items: [
                ...content.querySelectorAll(":scope > [data-page-item]"),
              ].map((item) => [
                item.hidden,
                item.getBoundingClientRect().height,
              ]),
            })
          : null;
        stableFrames =
          snapshot !== null && snapshot === previous ? stableFrames + 1 : 0;
        previous = snapshot;
        if (stableFrames >= 3) resolve();
        else if (globalThis.performance.now() - started > 5_000)
          reject(
            new Error("Page layout did not settle before capture navigation"),
          );
        else globalThis.requestAnimationFrame(frame);
      }
      globalThis.requestAnimationFrame(frame);
    });
  });
}

async function reveal(page, control) {
  // Font metrics, text splitting and ResizeObserver can change the page map
  // after a click. Wait for committed layout before reading a disabled pager.
  if (await page.locator("[data-page-deck]").count()) await settleDeck(page);
  if (await control.isVisible()) return;
  const deck = page.locator("[data-page-deck]:visible");
  const previous = page.getByRole("button", { name: /(?:：|の)前のページ$/ });
  if ((await previous.count()) !== 1)
    throw new Error("Expected one visible page deck");
  for (let count = 0; count < 500 && (await previous.isEnabled()); count++) {
    await previous.click();
    await settleDeck(page);
  }
  const next = page.getByRole("button", { name: /(?:：|の)次のページ$/ });
  for (let count = 0; count < 500; count++) {
    if (await control.isVisible()) return;
    if (!(await next.isEnabled())) break;
    const before = await deck
      .locator("[data-page-current]")
      .getAttribute("data-page-current");
    await next.click();
    await settleDeck(page);
    const after = await deck
      .locator("[data-page-current]")
      .getAttribute("data-page-current");
    if (after === before)
      throw new Error(
        `Page did not advance from ${before} while revealing ${control}`,
      );
  }
  const status = await deck
    .locator(".page-controls [role='status']")
    .textContent();
  throw new Error(
    `Requested input was not reachable through the page controls (${status}): ${control}`,
  );
}

async function capture(page, variant, screen) {
  if (await page.locator("[data-page-deck]:visible").count())
    await settleDeck(page);
  await page.evaluate(async () => {
    globalThis.scrollTo(0, 0);
    await globalThis.document.fonts.ready;
  });
  await page.waitForTimeout(150);
  const filename = `${variant}-${screen}.png`;
  const image = path.join(output, filename);
  await page.screenshot({
    path: image,
    fullPage: false,
    animations: "disabled",
  });
  const layout = await page.evaluate(() => ({
    viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
    document: {
      width: Math.max(
        globalThis.document.documentElement.scrollWidth,
        globalThis.document.body.scrollWidth,
      ),
      height: Math.max(
        globalThis.document.documentElement.scrollHeight,
        globalThis.document.body.scrollHeight,
      ),
    },
    scroll: { x: globalThis.scrollX, y: globalThis.scrollY },
    heading: globalThis.document.querySelector(".game-view h2")?.textContent,
    controls: [...globalThis.document.querySelectorAll("button")]
      .filter(
        (button) =>
          !button.closest("[hidden], [inert]") &&
          button.getClientRects().length > 0,
      )
      .map((button) => {
        const box = button.getBoundingClientRect();
        return {
          label: button.getAttribute("aria-label") ?? button.textContent.trim(),
          top: box.top,
          bottom: box.bottom,
          inViewport: box.top >= 0 && box.bottom <= globalThis.innerHeight,
        };
      }),
  }));
  const bytes = (await stat(image)).size;
  results.push({ variant, screen, filename, bytes, ...layout });
  console.log(
    JSON.stringify({
      screenshot: filename,
      bytes,
      documentHeight: layout.document.height,
    }),
  );
}

async function journey(variant, project) {
  // The baseline remains on its published wording; compare the same actions
  // using the precise accessible names from each content version.
  const copy =
    variant === "before"
      ? {
          start: "ゲームを始める",
          seed: "再現用seed（任意）",
          compare: "1年・5年を比較する",
          preview: "政策プレビュー",
        }
      : {
          start: "はじめる",
          seed: "再現用コード（任意）",
          compare: "見通しを確認",
          preview: "政策の見通し",
        };
  const url = await serve(path.join(project, "apps/web/dist"));
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: copy.start, exact: true }).waitFor();
    const seed = page.getByRole("textbox", {
      name: copy.seed,
      exact: true,
    });
    await reveal(page, seed);
    await seed.fill("issue-89-viewport-comparison");
    await page.getByRole("button", { name: copy.start, exact: true }).click();
    await page
      .getByRole("heading", { name: "国家ホーム", exact: true })
      .waitFor();
    await capture(page, variant, "home");
    await page
      .getByRole("button", { name: "国家の景観を見る", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "国家ビュー", exact: true })
      .waitFor();
    await capture(page, variant, "nation");
    await page.getByRole("button", { name: "政策会議", exact: true }).click();
    const value = page.getByRole("spinbutton", {
      name: "政策金利の設定値",
      exact: true,
    });
    await reveal(page, value);
    await value.fill("0.05");
    await page.getByRole("button", { name: copy.compare, exact: true }).click();
    await page
      .getByRole("heading", { name: copy.preview, exact: true })
      .waitFor();
    await capture(page, variant, "preview");
  } finally {
    await context.close();
  }
}

try {
  await mkdir(output, { recursive: true });
  const baseRef = process.env.SCREENSHOT_BASE_REF || "origin/main";
  baseCommit = await run("git", [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${baseRef}^{commit}`,
  ]);
  if (!/^[a-f0-9]{40,64}$/.test(baseCommit))
    throw new Error("Screenshot base must resolve to a commit SHA");
  await run("git", ["worktree", "add", "--detach", baseline, baseCommit]);
  worktreeCreated = true;
  // This UI-only change keeps the workspace domain/model/engine packages fixed.
  await symlink(
    path.join(root, "node_modules"),
    path.join(baseline, "node_modules"),
    "dir",
  );
  await build(baseline);
  await build(root);
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  await journey("before", baseline);
  await journey("after", root);
} catch (error) {
  failure = error;
} finally {
  await browser?.close();
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
  await writeFile(
    path.join(output, "comparison.json"),
    JSON.stringify(
      {
        baseCommit,
        viewport: { width: 360, height: 640 },
        seed: "issue-89-viewport-comparison",
        reducedMotion: "reduce",
        capturedAt: new Date().toISOString(),
        ...(failure ? { error: failure.message } : {}),
        results,
      },
      null,
      2,
    ) + "\n",
  );
  if (worktreeCreated)
    await run("git", ["worktree", "remove", "--force", baseline]);
  await rm(scratch, { recursive: true, force: true });
}
if (failure) throw failure;
