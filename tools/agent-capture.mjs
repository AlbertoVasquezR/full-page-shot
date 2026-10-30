#!/usr/bin/env node
// Simple CLI for AI agents: capture a full page and save it to disk.
// Usage: node tools/agent-capture.mjs <url> [--format=png|jpeg] [--out=path] [--visible]
// Prints a JSON line with the saved file path and dimensions.
import puppeteer from "puppeteer-core";
import { captureFullPage, captureVisible } from "../mcp/capture.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const format = (args.find((a) => a.startsWith("--format=")) || "").split("=")[1] || "png";
const quality = Number((args.find((a) => a.startsWith("--quality=")) || "").split("=")[1] || 92);
const outPath = (args.find((a) => a.startsWith("--out=")) || "").split("=")[1];
const visible = args.includes("--visible");
const port = Number(process.env.CHROME_DEBUG_PORT || 9222);

if (!url) {
  console.error(JSON.stringify({ error: "Usage: agent-capture.mjs <url> [--format=png|jpeg] [--out=path] [--visible]" }));
  process.exit(1);
}

async function connectOrLaunch() {
  try {
    return await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
  } catch {
    // auto-launch
    const candidates = process.platform === "win32"
      ? ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium-browser"];
    const fs = await import("node:fs");
    const exe = candidates.find((c) => fs.existsSync(c));
    if (!exe) throw new Error("No Chrome/Edge found");
    const profileDir = process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA, "full-page-shot-agent-profile")
      : path.join(process.env.HOME, ".full-page-shot-agent-profile");
    const browser = await puppeteer.launch({
      executablePath: exe, headless: false, userDataDir: profileDir, defaultViewport: null,
      args: [`--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check"],
    });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
    return browser;
  }
}

const browser = await connectOrLaunch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

const result = visible
  ? await captureVisible(page, { format, quality })
  : await captureFullPage(page, { format, quality });

await page.close().catch(() => {});

const outDir = outPath ? path.dirname(path.resolve(outPath)) : path.join(os.homedir(), "Downloads", "FullPageShot");
mkdirSync(outDir, { recursive: true });
const fileName = outPath ? path.basename(outPath) : `capture-${new URL(url).hostname}-${Date.now()}.${format === "jpeg" ? "jpg" : "png"}`;
const filePath = path.join(outDir, fileName);
writeFileSync(filePath, Buffer.from(result.base64, "base64"));

console.log(JSON.stringify({ ok: true, file: filePath, width: result.width, height: result.height, downscaled: result.downscaled, format }));
process.exit(0);