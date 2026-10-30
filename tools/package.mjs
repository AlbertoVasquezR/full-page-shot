#!/usr/bin/env node
// Empaqueta dist/ en un zip versionado listo para subir a GitHub Releases.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version || "1.0.0";
const zipName = `full-page-shot-v${version}.zip`;
const zipPath = path.join(root, zipName);
const distDir = path.join(root, "dist");

if (!existsSync(path.join(distDir, "manifest.json"))) {
  console.error("dist/ no existe. Ejecuta npm run build primero.");
  process.exit(1);
}

// Build first
console.log("Compilando...");
execSync("npm run build", { cwd: root, stdio: "inherit" });

// Zip
if (existsSync(zipPath)) rmSync(zipPath);
// Use PowerShell on Windows, zip on unix
if (process.platform === "win32") {
  execSync(`powershell -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: "inherit" });
} else {
  execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: "inherit" });
}

console.log(`\nPaquete creado: ${zipName}`);
console.log(`Para subir a GitHub: gh release create v${version} ${zipName} --title "v${version}" --notes "..."`);