#!/usr/bin/env node
// Minimal MCP server (stdio, JSON-RPC 2.0) exposing full-page capture to AI agents.
// Connects to a running Chrome/Edge instance via remote debugging (default port 9222).
// Launch Chrome with:  chrome --remote-debugging-port=9222  (and load the extension if desired)

import puppeteer from "puppeteer-core";
import { captureFullPage, captureVisible } from "./capture.mjs";
import readline from "node:readline";

const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "";

let browser = null;

async function findChrome() {
  const candidates = process.platform === "win32"
    ? ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
       "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
       "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
       "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  const fs = await import("node:fs");
  return candidates.find((c) => fs.existsSync(c));
}

async function launchChrome() {
  const profileDir = process.env.CHROME_PROFILE_DIR || (process.platform === "win32"
    ? (await import("node:path")).join(process.env.LOCALAPPDATA, "full-page-shot-agent-profile")
    : (await import("node:path")).join(process.env.HOME, ".full-page-shot-agent-profile"));
  const exe = await findChrome();
  if (!exe) throw new Error("No Chrome/Edge executable found. Set CHROME_PATH env var.");
  const headless = process.env.CHROME_HEADLESS === "1";
  const b = await puppeteer.launch({
    executablePath: exe,
    headless,
    userDataDir: profileDir,
    defaultViewport: null,
    args: [
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  // wait for debugging endpoint
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return b;
}

async function connect() {
  if (browser) return browser;
  // try existing
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}`, defaultViewport: null });
    return browser;
  } catch {
    // auto-launch
    browser = await launchChrome();
    return browser;
  }
}

async function getActivePage() {
  const b = await connect();
  const pages = await b.pages();
  // prefer a non-chrome-internal page
  return pages.find((p) => !p.url().startsWith("chrome://") && !p.url().startsWith("chrome-extension://")) || pages[0];
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let buf = "";
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;

  try {
    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "full-page-shot", version: "1.1.0" },
      }});
      return;
    }
    if (method === "notifications/initialized") {
      return; // no response
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: [
        {
          name: "browser_status",
          description: "Check if Chrome/Edge is connected and ready. Auto-launches if needed. Returns the browser version.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "capture_full_page",
          description: "Capture a full-page screenshot of the current or specified tab. Returns a base64 PNG/JPEG of the entire scrollable page.",
          inputSchema: { type: "object", properties: {
            url: { type: "string", description: "URL to navigate to before capturing (optional; uses active tab if omitted)" },
            tabId: { type: "number", description: "Chrome tab id to capture (optional)" },
            format: { type: "string", enum: ["png", "jpeg"], description: "Output format (default png)" },
            quality: { type: "number", description: "JPEG quality 1-100 (default 92)" },
          } },
        },
        {
          name: "capture_visible",
          description: "Capture only the currently visible viewport (no scrolling).",
          inputSchema: { type: "object", properties: {
            url: { type: "string", description: "URL to navigate to before capturing (optional)" },
            format: { type: "string", enum: ["png", "jpeg"] },
            quality: { type: "number" },
          } },
        },
        {
          name: "list_tabs",
          description: "List open tabs (id, url, title).",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "navigate",
          description: "Navigate a tab to a URL.",
          inputSchema: { type: "object", properties: {
            tabId: { type: "number", description: "Tab id" },
            url: { type: "string", description: "URL to navigate to" },
          }, required: ["tabId", "url"] },
        },
      ] } });
      return;
    }
    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      if (name === "list_tabs") {
        const b = await connect();
        const pages = await b.pages();
        const tabs = pages.map((p, i) => ({ index: i, url: p.url(), title: "" }));
        // get titles
        for (const t of tabs) {
          try { t.title = await pages[t.index].title(); } catch {}
        }
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] } });
        return;
      }
      if (name === "navigate") {
        const b = await connect();
        const pages = await b.pages();
        const page = pages.find((_, i) => i === (args.tabId ?? 0)) || pages[0];
        await page.goto(args.url, { waitUntil: "networkidle2", timeout: 60000 });
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Navigated to ${args.url}` }] } });
        return;
      }
      if (name === "browser_status") {
        try {
          const b = await connect();
          const version = await b.version();
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ connected: true, version }, null, 2) }] } });
        } catch (e) {
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ connected: false, error: String(e?.message || e) }) }] } });
        }
        return;
      }
      if (name === "capture_full_page" || name === "capture_visible") {
        const b = await connect();
        let page;
        if (args.url) {
          page = await b.newPage();
          await page.goto(args.url, { waitUntil: "networkidle2", timeout: 60000 });
        } else {
          page = await getActivePage();
        }
        const opts = { format: args.format || "png", quality: args.quality || 92 };
        const result = name === "capture_full_page"
          ? await captureFullPage(page, opts)
          : await captureVisible(page, opts);
        // close the temporary page if we created one
        if (args.url) await page.close().catch(() => {});
        send({ jsonrpc: "2.0", id, result: { content: [
          { type: "image", data: result.base64, mimeType: result.mimeType },
          { type: "text", text: `Captured ${result.width}x${result.height} (${result.downscaled ? "downscaled" : "full"})` },
        ] } });
        return;
      }
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
      return;
    }
    // unknown method
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e?.message || e) } });
  }
});

process.on("uncaughtException", (e) => { process.stderr.write("uncaught: " + e + "\n"); });