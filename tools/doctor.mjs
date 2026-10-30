#!/usr/bin/env node
// Quick health check: verifies the environment is ready to use the extension and agents.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const manifestPath = path.join(distDir, "manifest.json");

const checks = [];
function ok(name, detail) { checks.push({ name, status: "ok", detail }); }
function fail(name, detail) { checks.push({ name, status: "fail", detail }); }
function warn(name, detail) { checks.push({ name, status: "warn", detail }); }

// Node
try { ok("Node.js", process.version); } catch { fail("Node.js", "not found"); }

// npm deps
const nm = path.join(root, "node_modules");
if (existsSync(nm)) ok("node_modules", "installed"); else fail("node_modules", "run: npm install");

// Build
if (existsSync(manifestPath)) ok("dist/", "built"); else fail("dist/", "run: npm run build");

// Chrome/Edge
const candidates = process.platform === "win32"
  ? ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const browser = candidates.find(existsSync);
if (browser) ok("Browser", browser); else fail("Browser", "Chrome/Edge not found");

// Git
try { const v = execSync("git --version", { encoding: "utf8" }).trim(); ok("Git", v); } catch { warn("Git", "not found (optional)"); }

// GH CLI
try { const v = execSync("gh --version", { encoding: "utf8" }).split("\n")[0].trim(); ok("GitHub CLI", v); } catch { warn("GitHub CLI", "not found (optional, for releases)"); }

// Print
console.log("");
let allOk = true;
for (const c of checks) {
  const icon = c.status === "ok" ? "✅" : c.status === "warn" ? "⚠️" : "❌";
  console.log(`${icon} ${c.name}: ${c.detail}`);
  if (c.status === "fail") allOk = false;
}
console.log("");
if (allOk) {
  console.log("Todo listo. Para capturar: npm run capture -- <url>");
} else {
  console.log("Hay problemas. Sigue las instrucciones de arriba.");
  process.exitCode = 1;
}