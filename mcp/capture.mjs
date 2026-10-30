// Full-page capture logic shared by the MCP server. Mirrors the extension's
// capture engine (measure -> scroll -> capture -> stitch) so agents get the same
// results without depending on the extension being loaded.

const SETTLE_MS = 120;

export async function measurePage(page) {
  return await page.evaluate(() => {
    function scroller() {
      if (document.body && document.body.scrollHeight > document.body.clientHeight + 1) return document.body;
      if (document.documentElement.scrollHeight > document.documentElement.clientHeight + 1) return document.documentElement;
      let best = null;
      const nodes = document.querySelectorAll("*");
      const limit = Math.min(nodes.length, 4000);
      for (let i = 0; i < limit; i++) {
        const n = nodes[i];
        const cs = getComputedStyle(n);
        if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
          if (n.scrollHeight > n.clientHeight + 50) {
            if (!best || n.scrollHeight > best.scrollHeight) best = n;
          }
        }
      }
      return best || document.documentElement;
    }
    const s = scroller();
    const width = Math.max(1, Math.ceil(Math.max(s.scrollWidth, document.documentElement.scrollWidth, window.innerWidth)));
    const height = Math.max(1, Math.ceil(Math.max(s.scrollHeight, document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)));
    const nested = document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1;
    const viewportHeight = window.innerHeight;
    return { width, height, nested, viewportHeight };
  });
}

async function scrollBy(page, y) {
  await page.evaluate((yy) => {
    function scroller() {
      if (document.body && document.body.scrollHeight > document.body.clientHeight + 1) return document.body;
      if (document.documentElement.scrollHeight > document.documentElement.clientHeight + 1) return document.documentElement;
      let best = null;
      const nodes = document.querySelectorAll("*");
      const limit = Math.min(nodes.length, 4000);
      for (let i = 0; i < limit; i++) {
        const n = nodes[i];
        const cs = getComputedStyle(n);
        if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
          if (n.scrollHeight > n.clientHeight + 50) {
            if (!best || n.scrollHeight > best.scrollHeight) best = n;
          }
        }
      }
      return best || document.documentElement;
    }
    const s = scroller();
    s.scrollTop = yy;
    try { if (s === document.documentElement || s === document.body) window.scrollTo(0, yy); } catch (e) {}
  }, Math.max(0, Math.round(y)));
  await new Promise((r) => setTimeout(r, SETTLE_MS));
}

async function captureViewport(page, format, quality) {
  const opts = { type: format === "jpeg" ? "jpeg" : "png", fullPage: false };
  if (format === "jpeg") opts.quality = quality;
  const buf = await page.screenshot(opts);
  return buf.toString("base64");
}

export async function captureFullPage(page, { format = "png", quality = 92 } = {}) {
  const { width, height } = await measurePage(page);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const step = Math.max(200, Math.min(viewportHeight, height));
  const lastY = Math.max(0, height - step);
  const total = Math.max(1, Math.ceil(height / step));

  const slices = []; // { base64, y, height }

  await scrollBy(page, 0);
  const firstH = Math.min(step, height);
  slices.push({ base64: await captureViewport(page, format, quality), y: 0, height: firstH });

  if (total > 1) {
    // hide sticky headers from slice 2
    await page.evaluate(() => {
      const els = document.querySelectorAll("body *");
      for (const el of els) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.position === "sticky") {
          if (cs.display !== "none" && cs.visibility !== "hidden") {
            el.setAttribute("data-fps-hidden", "1");
            el.style.setProperty("visibility", "hidden", "important");
          }
        }
      }
    });
    try {
      for (let i = 1; i < total; i++) {
        const y = Math.min(i * step, lastY);
        await scrollBy(page, y);
        slices.push({ base64: await captureViewport(page, format, quality), y, height: step });
      }
    } finally {
      await page.evaluate(() => {
        document.querySelectorAll("[data-fps-hidden]").forEach((el) => {
          el.removeAttribute("data-fps-hidden");
          el.style.removeProperty("visibility");
        });
      });
    }
  }

  await scrollBy(page, 0);

  // stitch
  const MAX_DIM = 30000;
  const MAX_PX = 40_000_000;
  const ratio = Math.min(MAX_DIM / width, MAX_DIM / height, Math.sqrt(MAX_PX / (width * height)), 1);
  const outW = Math.max(1, Math.round(width * ratio));
  const outH = Math.max(1, Math.round(height * ratio));

  const stitched = await page.evaluate(async (slices, outW, outH, ratio) => {
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (const s of slices) {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + s.base64; });
      const top = Math.round(s.y * ratio);
      const bottom = Math.round((s.y + s.height) * ratio);
      ctx.drawImage(img, 0, top, outW, Math.max(1, bottom - top));
    }
    return canvas.toDataURL("image/png").split(",")[1];
  }, slices, outW, outH, ratio);

  return {
    base64: stitched,
    mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
    width: outW,
    height: outH,
    downscaled: ratio < 1,
    slices: slices.length,
  };
}

export async function captureVisible(page, { format = "png", quality = 92 } = {}) {
  const buf = await captureViewport(page, format, quality);
  // decode dims via image
  const dims = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    return { width: img.width, height: img.height };
  }, buf);
  return { base64: buf, mimeType: format === "jpeg" ? "image/jpeg" : "image/png", width: dims.width, height: dims.height, downscaled: false };
}