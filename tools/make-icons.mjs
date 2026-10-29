/**
 * Genera los iconos PNG de la extension sin dependencias externas:
 * codificador PNG minimo (zlib + CRC32) y rasterizado con supermuestreo 4x.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
const SIZES = [16, 32, 48, 128];

const GRADIENT_TOP = [37, 99, 235]; // #2563EB
const GRADIENT_BOTTOM = [124, 58, 237]; // #7C3AED
const LINE_COLOR = [99, 102, 241]; // #6366F1
const WHITE = [255, 255, 255];

/* ------------------------------ Codificador PNG ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // color RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------- Geometria --------------------------------- */

function inRoundedRect(u, v, x, y, w, h, r) {
  if (u < x || u > x + w || v < y || v > y + h) return false;
  const rx = Math.min(r, w / 2);
  const ry = Math.min(r, h / 2);
  const dx = Math.max(x + rx - u, u - (x + w - rx), 0);
  const dy = Math.max(y + ry - v, v - (y + h - ry), 0);
  if (dx === 0 || dy === 0) return true;
  if (rx <= 0 || ry <= 0) return false;
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}

const BRACKET_INSET = 0.17;
const BRACKET_ARM = 0.21;
const BRACKET_THICK = 0.085;

/** Marcas de encuadre en las cuatro esquinas, como un visor de camara. */
function inBrackets(u, v) {
  const left = BRACKET_INSET;
  const right = 1 - BRACKET_INSET;
  const top = BRACKET_INSET;
  const bottom = 1 - BRACKET_INSET;
  const arm = BRACKET_ARM;
  const thick = BRACKET_THICK;

  const horizontal = v >= top && v <= top + thick;
  const vertical = u >= left && u <= left + thick;
  if ((horizontal || vertical) && u >= left && u <= left + arm && v >= top && v <= top + arm) return true;

  const horizontalR = v >= top && v <= top + thick;
  const verticalR = u <= right && u >= right - thick;
  if ((horizontalR || verticalR) && u <= right && u >= right - arm && v >= top && v <= top + arm) return true;

  const horizontalB = v <= bottom && v >= bottom - thick;
  const verticalB = u >= left && u <= left + thick;
  if ((horizontalB || verticalB) && u >= left && u <= left + arm && v <= bottom && v >= bottom - arm) return true;

  const horizontalBR = v <= bottom && v >= bottom - thick;
  const verticalBR = u <= right && u >= right - thick;
  if ((horizontalBR || verticalBR) && u <= right && u >= right - arm && v <= bottom && v >= bottom - arm) return true;

  return false;
}

const PAGE = { x: 0.415, y: 0.22, w: 0.17, h: 0.56, r: 0.035 };
const PAGE_LINES = [0.3, 0.375, 0.45, 0.525, 0.6];

function inPageLines(u, v) {
  if (u < 0.455 || u > 0.545) return false;
  return PAGE_LINES.some((y) => v >= y && v <= y + 0.017);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function sample(u, v, size) {
  if (!inRoundedRect(u, v, 0.02, 0.02, 0.96, 0.96, 0.22)) return [0, 0, 0, 0];
  if (inBrackets(u, v)) return [...WHITE, 255];

  if (inRoundedRect(u, v, PAGE.x, PAGE.y, PAGE.w, PAGE.h, PAGE.r)) {
    if (size >= 48 && inPageLines(u, v)) return [...LINE_COLOR, 255];
    return [...WHITE, 255];
  }

  const background = mix(GRADIENT_TOP, GRADIENT_BOTTOM, v);
  return [background[0], background[1], background[2], 255];
}

function render(size) {
  const samples = 4;
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          const [r, g, b, a] = sample(u, v, size);
          const alpha = a / 255;
          pr += r * alpha;
          pg += g * alpha;
          pb += b * alpha;
          pa += a;
        }
      }

      const total = samples * samples;
      const averageAlpha = pa / total;
      const index = (y * size + x) * 4;
      const weight = averageAlpha / 255;

      rgba[index] = weight > 0 ? Math.round(Math.min(255, pr / total / weight)) : 0;
      rgba[index + 1] = weight > 0 ? Math.round(Math.min(255, pg / total / weight)) : 0;
      rgba[index + 2] = weight > 0 ? Math.round(Math.min(255, pb / total / weight)) : 0;
      rgba[index + 3] = Math.round(averageAlpha);
    }
  }

  return rgba;
}

mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const file = path.join(outDir, `icon${size}.png`);
  writeFileSync(file, encodePng(size, size, render(size)));
  console.log(`icono generado: ${path.relative(root, file)}`);
}
