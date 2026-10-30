#!/usr/bin/env node
// Launch Chrome/Edge with the extension loaded and remote debugging enabled,
// so AI agents (via the MCP server) can connect and capture pages.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const port = Number(process.env.CHROME_DEBUG_PORT || 9222);
const profileDir = process.env.CHROME_PROFILE_DIR || (process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA, "full-page-shot-agent-profile")
  : path.join(process.env.HOME, ".full-page-shot-agent-profile"));

const candidates = process.platform === "win32"
  ? ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
     "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];

const exe = candidates.find(existsSync);
if (!exe) { console.error("No Chrome/Edge executable found."); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: false,
  userDataDir: profileDir,
  args: [
    `--remote-debugging-port=${port}`,
    `--disable-extensions-except=${distDir}`,
    `--load-extension=${distDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});
console.log(`Chrome launched with remote debugging on port ${port}.`);
console.log(`Profile: ${profileDir}`);
console.log("Keep this process running. Press Ctrl+C to stop.");
process.on("SIGINT", async () => { await browser.close(); process.exit(0); });
// keep alive
await new Promise(() => {});