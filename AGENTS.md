# AGENTS.md — Full Page Shot

> **TL;DR for AI agents:** This repo contains a browser extension AND a self-contained MCP server + CLI
> that let you capture full-page screenshots of any URL (including logged-in pages).
> To capture a page: `node tools/agent-capture.mjs <url>` → returns JSON with the saved file path.
> Or use the MCP server for inline base64 images. No setup beyond `npm install`.
>
> **Token savings:** capturing a long page with computer-use costs dozens of calls and thousands of
> orchestration tokens. This tool does it in a single call and returns the ready image — you only
> spend tokens understanding it, not producing it.

---

## What this project does

Full Page Shot captures **entire web pages** (full scroll, any length) as PNG/JPEG.
It handles pages up to 65,000+ px tall, pages with internal scroll containers (CT System),
lazy-loaded content, Canvas/WebGL, cookie banners, and more.

Two interfaces for agents:
1. **CLI** — `node tools/agent-capture.mjs <url>` → saves image to disk, prints JSON.
2. **MCP server** — stdio JSON-RPC with tools that return base64 images inline.

## Quick capture (fastest)

```bash
# Capture a page (auto-launches Chrome if needed)
node tools/agent-capture.mjs https://example.com

# Output: {"ok":true,"file":".../capture-example.com-123.png","width":1280,"height":800,...}

# JPEG with custom quality
node tools/agent-capture.mjs https://example.com --format=jpeg --quality=80

# Custom output path
node tools/agent-capture.mjs https://example.com --out=/tmp/screenshot.png

# Visible viewport only (no scroll)
node tools/agent-capture.mjs https://example.com --visible
```

## MCP server (for Claude Code, Cursor, etc.)

### Setup (one-time)
Add to `~/.claude.json` or project `.mcp.json`:
```json
{
  "mcpServers": {
    "full-page-shot": {
      "command": "node",
      "args": ["mcp/server.mjs"]
    }
  }
}
```

The server **auto-launches Chrome** on first use. No manual steps.

### Tools

#### `capture_full_page`
Capture an entire page (full scroll height).
```json
{ "url": "https://example.com", "format": "png", "quality": 92 }
```
Returns: `{ content: [{ type: "image", data: "<base64>", mimeType: "image/png" }, { type: "text", text: "Captured WxH (full)" }] }`

#### `capture_visible`
Capture only the visible viewport.
```json
{ "url": "https://example.com", "format": "png" }
```

#### `list_tabs`
List open tabs. Returns JSON array of `{ index, url, title }`.

#### `navigate`
Navigate a tab to a URL.
```json
{ "tabId": 0, "url": "https://example.com" }
```

#### `browser_status`
Check if Chrome is connected. Auto-launches if needed. Returns `{ connected: bool, version: "..." }`.

## How capture works

1. Connect to Chrome via remote debugging (port 9222, auto-launch if needed).
2. Navigate to the URL (if provided).
3. Measure the page's full scrollable height (handles normal pages AND internal-scroll containers like CT System, where `html { overflow: hidden }` and body scrolls).
4. Walk the page screen-by-screen (viewport height per step), capturing each viewport.
5. Hide fixed/sticky headers from the 2nd screen onward (no duplicates).
6. Stitch all captures into a single image (automatic downscaling for pages > 30,000 px).
7. Return the image as base64 (MCP) or save to disk (CLI).

## Auto-detection (smart mode)

The capture engine detects whether a page needs scroll-based capture:
- Lazy images (`loading="lazy"`, `data-src`)
- `content-visibility: auto`
- Entrance animations (`data-aos`, `data-wow`, etc.)
- Internal scroll containers (`overflow: auto/scroll`)
- Virtualized lists (50+ children in a scroll container)
- Heavy iframes
- Scroll-snap layout
- Parallax (`background-attachment: fixed`)
- Lazy background images
- Smooth scroll behavior
- `will-change` on many elements
- **Behavioral test**: scrolls the page and checks if new nodes or visibility classes appear

If any signal triggers → scroll mode. Otherwise → fast mode (single capture).

## Key files

| File | Purpose |
|------|---------|
| `src/capture.ts` | Capture engine (measure, scroll, capture, stitch, auto-detect) |
| `src/background.ts` | Service worker (orchestration, clipboard, downloads, notifications) |
| `mcp/capture.mjs` | Same capture engine in Node.js (for agents) |
| `mcp/server.mjs` | MCP server (stdio JSON-RPC) |
| `mcp/launch-chrome.mjs` | Chrome launcher with remote debugging |
| `tools/agent-capture.mjs` | CLI for agents (one-shot capture) |
| `tools/smoke-test.mjs` | End-to-end tests (12 scenarios) |
| `tools/verify-clipboard.mjs` | Clipboard verification |

## Build & test

```bash
npm run check                    # typecheck + build
npm run build                    # build only
node tools/smoke-test.mjs --include-segments   # 12 E2E scenarios
node tools/verify-clipboard.mjs                # clipboard verification
node tools/agent-capture.mjs https://example.com  # agent CLI test
```

## Important notes for agents

- **No `host_permissions`**: the extension reads URL/title via CDP, not content scripts.
- **No native messaging, no Go, no registry**: pure Node.js + puppeteer-core.
- **Code comments are in English.** User-facing messages are in Spanish.
- **Do NOT add AI co-authorship** to commits (no `Co-authored-by` trailers).
- The extension and MCP server share the same capture concept but are independent.
- For logged-in pages, the agent connects to the user's real Chrome (session persists).
- The MCP server auto-launches Chrome if not running (dedicated profile).

## Troubleshooting for agents

| Problem | Solution |
|---------|----------|
| "No Chrome/Edge executable found" | Set `CHROME_PATH` env var or install Chrome/Edge |
| "connect ECONNREFUSED" | Chrome not running with debugging. The server auto-launches; wait a few seconds. |
| Capture returns empty/blank | The page may need login. Log in via the Chrome window first. |
| "page.goto timeout" | The page is slow. Increase timeout or check network. |
| Huge base64 response | Normal for long pages. Use `--out` in CLI to save to file instead. |