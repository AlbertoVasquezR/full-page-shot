import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const outDir = path.join(root, "assets", "screenshots");
const profileDir = path.join(os.tmpdir(), "fps-screenshots-profile");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
rmSync(profileDir, { recursive: true, force: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false,
  userDataDir: profileDir,
  defaultViewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`, "--no-first-run", "--no-default-browser-check"],
});

try {
  const wt = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes("background.js"), { timeout: 30000 });
  const extId = new URL(wt.url()).host;

  // 1. Popup screenshot (idle state)
  const popupPage = await browser.newPage();
  await popupPage.setViewport({ width: 340, height: 400 });
  await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 1000));
  await popupPage.screenshot({ path: path.join(outDir, "popup-idle.png"), type: "png" });
  console.log("saved popup-idle.png");

  // 2. Options page screenshot
  const optionsPage = await browser.newPage();
  await optionsPage.setViewport({ width: 640, height: 900 });
  await optionsPage.goto(`chrome-extension://${extId}/options.html`, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 1000));
  await optionsPage.screenshot({ path: path.join(outDir, "options.png"), type: "png", fullPage: true });
  console.log("saved options.png");

  // 3. A long test page screenshot (for before/after comparison)
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><style>html,body{margin:0;padding:0}body{height:4000px;background:linear-gradient(180deg,#fff 0%,#0f172a 100%)} .sticky{position:fixed;inset:0 0 auto 0;height:56px;background:#ef4444} .bottom{position:absolute;left:0;right:0;top:3860px;height:140px;background:#22c55e}</style></head><body><div class="sticky"></div><div class="bottom"></div></body></html>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const contentPage = await browser.newPage();
  await contentPage.setViewport({ width: 1280, height: 800 });
  await contentPage.goto(url, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 1000));
  await contentPage.screenshot({ path: path.join(outDir, "page-before.png"), type: "png", fullPage: false });
  console.log("saved page-before.png");

  server.close();
  console.log("Done. Screenshots in assets/screenshots/");
} finally {
  await browser.close().catch(() => {});
  rmSync(profileDir, { recursive: true, force: true });
}