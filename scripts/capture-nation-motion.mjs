import { execFile } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";

/* global document, HTMLElement, HTMLImageElement, HTMLCanvasElement, getComputedStyle, requestAnimationFrame, cancelAnimationFrame, MediaRecorder, FileReader */

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "artifacts/issue-92");
const scratch = await mkdtemp(path.join(tmpdir(), "macro-nation-motion-"));
const baseline = path.join(scratch, "before");
const scratchRoot = path.resolve(tmpdir()) + path.sep;
if (!path.resolve(scratch).startsWith(scratchRoot))
  throw new Error("Refusing to remove a scratch directory outside tmpdir");
if (path.dirname(path.resolve(baseline)) !== path.resolve(scratch))
  throw new Error("Refusing to remove a worktree outside scratch");
const files = [];
const servers = [];
let browser;
let worktreeCreated = false;
let modulesLinked = false;
let baseCommit;
let failure;

async function run(command, args, cwd = root, env = process.env) {
  const { stdout } = await execute(command, args, {
    cwd,
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function build(project) {
  await run(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "build",
      "--configLoader",
      "runner",
    ],
    path.join(project, "apps/web"),
    { ...process.env, VITE_BASE_PATH: "/", VITE_AI_ENABLED: "false" },
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

async function openNation(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: /^(はじめる|ゲームを始める)$/ })
    .click();
  const heading = page.getByRole("heading", {
    name: "国家ビュー",
    exact: true,
  });
  if (!(await heading.isVisible()))
    await page.getByRole("button", { name: "国家ビュー", exact: true }).click();
  await heading.waitFor();
  const image = page.locator(".nation-view img.nation-landscape");
  await image.evaluate((element) => element.decode());
  await page.locator(".nation-view canvas.nation-motion-canvas").waitFor();
}

async function save(page, filename, options = {}) {
  const target = path.join(output, filename);
  await page.screenshot({ path: target, fullPage: false, ...options });
  files.push({ filename, bytes: (await stat(target)).size });
}

async function captureMotion(variant, url) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await openNation(page, url);
    await page.waitForTimeout(700);
    await save(page, `${variant}-normal.png`, { animations: "disabled" });
    const video = await page.evaluate(async () => {
      const scene = document.querySelector(".nation-view .nation-scene");
      const art = scene?.querySelector("img.nation-landscape");
      const motion = scene?.querySelector("canvas.nation-motion-canvas");
      if (
        !(scene instanceof HTMLElement) ||
        !(art instanceof HTMLImageElement) ||
        !(motion instanceof HTMLCanvasElement)
      )
        throw new Error("Landscape image or motion canvas is unavailable");

      const composite = document.createElement("canvas");
      composite.width = Math.round(scene.clientWidth);
      composite.height = Math.round(scene.clientHeight);
      const context = composite.getContext("2d");
      if (!context || !composite.width || !composite.height)
        throw new Error("Landscape video canvas is unavailable");

      function drawElement(element, sourceWidth, sourceHeight) {
        const style = getComputedStyle(element);
        const [x = "50%", y = "50%"] = style.objectPosition.split(/\s+/);
        const xPosition = Number.parseFloat(x) / 100;
        const yPosition = Number.parseFloat(y) / 100;
        const scale =
          style.objectFit === "cover"
            ? Math.max(
                composite.width / sourceWidth,
                composite.height / sourceHeight,
              )
            : style.objectFit === "contain"
              ? Math.min(
                  composite.width / sourceWidth,
                  composite.height / sourceHeight,
                )
              : null;
        const width = scale === null ? composite.width : sourceWidth * scale;
        const height = scale === null ? composite.height : sourceHeight * scale;
        context.save();
        context.filter = style.filter;
        context.drawImage(
          element,
          (composite.width - width) * xPosition,
          (composite.height - height) * yPosition,
          width,
          height,
        );
        context.restore();
      }

      let frame;
      const draw = () => {
        context.clearRect(0, 0, composite.width, composite.height);
        drawElement(art, art.naturalWidth, art.naturalHeight);
        drawElement(motion, motion.width, motion.height);
        frame = requestAnimationFrame(draw);
      };
      draw();

      const stream = composite.captureStream(24);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      try {
        recorder.start();
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        recorder.stop();
        await stopped;
      } finally {
        cancelAnimationFrame(frame);
        stream.getTracks().forEach((track) => track.stop());
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob(chunks, { type: mimeType }));
      });
      return {
        base64: dataUrl.split(",")[1],
        width: composite.width,
        height: composite.height,
      };
    });
    const filename = `${variant}-motion.webm`;
    const target = path.join(output, filename);
    await writeFile(target, Buffer.from(video.base64, "base64"));
    files.push({
      filename,
      bytes: (await stat(target)).size,
      width: video.width,
      height: video.height,
    });
  } finally {
    await context.close();
  }
}

async function captureAlternatives(url) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await openNation(page, url);
    await page.getByRole("button", { name: "表示設定", exact: true }).click();
    await page
      .getByRole("combobox", { name: "景観の画質" })
      .selectOption("low");
    await page.getByRole("button", { name: "詳細を閉じる" }).click();
    await page
      .locator("canvas.nation-motion-canvas[data-quality='low']")
      .waitFor();
    await page.waitForTimeout(400);
    await save(page, "after-low.png", { animations: "disabled" });
    await page.getByRole("button", { name: "表示設定", exact: true }).click();
    await page
      .getByRole("combobox", { name: "景観の画質" })
      .selectOption("auto");
    await page.getByRole("button", { name: "詳細を閉じる" }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .locator("canvas.nation-motion-canvas[data-motion='still']")
      .waitFor();
    await page.waitForTimeout(150);
    await save(page, "after-reduced.png", { animations: "disabled" });
  } finally {
    await context.close();
  }
}

try {
  await mkdir(output, { recursive: true });
  const baseRef = process.env.SCREENSHOT_BASE_REF || "HEAD";
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
  await symlink(
    path.join(root, "node_modules"),
    path.join(baseline, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  modulesLinked = true;
  await build(baseline);
  await build(root);
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const beforeUrl = await serve(path.join(baseline, "apps/web/dist"));
  const afterUrl = await serve(path.join(root, "apps/web/dist"));
  await captureMotion("before", beforeUrl);
  await captureMotion("after", afterUrl);
  await captureAlternatives(afterUrl);
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
        videoSecondsOnScene: 3,
        capturedAt: new Date().toISOString(),
        ...(failure ? { error: String(failure.message ?? failure) } : {}),
        files,
      },
      null,
      2,
    ) + "\n",
  );
  if (modulesLinked) await unlink(path.join(baseline, "node_modules"));
  if (worktreeCreated)
    await run("git", ["worktree", "remove", "--force", baseline]);
  await rm(scratch, { recursive: true, force: true });
}
if (failure) throw failure;
