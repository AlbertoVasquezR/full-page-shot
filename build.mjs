import { build, context } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, "dist");
const publicDir = path.join(root, "public");
const srcDir = path.join(root, "src");

const watchMode = process.argv.includes("--watch");

/** Una entrada por contexto de la extension. El nombre de `out` define el .js final. */
const entryPoints = [
  { in: path.join(srcDir, "background.ts"), out: "background" },
  { in: path.join(srcDir, "popup.ts"), out: "popup" },
  { in: path.join(srcDir, "helper.ts"), out: "helper" },
  { in: path.join(srcDir, "options.ts"), out: "options" },
];

const buildOptions = {
  entryPoints,
  outdir: distDir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome116"],
  minify: !watchMode,
  sourcemap: watchMode ? "inline" : false,
  logLevel: "warning",
  legalComments: "none",
};

/** Copia manifest, html, css e iconos al directorio de salida. */
async function copyStatic() {
  await mkdir(distDir, { recursive: true });
  const entries = await readdir(publicDir, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      cp(path.join(publicDir, entry.name), path.join(distDir, entry.name), { recursive: true }),
    ),
  );
}

function watchStatic() {
  let timer;
  watch(publicDir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void copyStatic().then(() => console.log("[static] recursos copiados"));
    }, 120);
  });
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await copyStatic();

  if (watchMode) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    watchStatic();
    console.log("Modo desarrollo activo: edita src/ o public/ y se recompila solo.");
    return;
  }

  await build(buildOptions);
  console.log("Build listo en dist/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
