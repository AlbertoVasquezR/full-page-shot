# AGENTS.md — Full Page Shot

This file provides instructions for AI agents working with this repository.

## What this project does

Full Page Shot is a Microsoft Edge extension (Manifest V3, TypeScript, esbuild) that captures
full-page screenshots. It also ships an MCP server and a CLI for AI agents.

## Quick capture for agents

### Option 1: MCP server (recommended)
The MCP server is auto-configured via `.mcp.json`. Tools available:
- `capture_full_page(url, format?, quality?)` — captures the entire page, returns base64 image.
- `capture_visible(url?, format?, quality?)` — captures only the visible viewport.
- `list_tabs()` — lists open tabs.
- `navigate(tabId, url)` — navigates a tab.
- `browser_status()` — checks if Chrome is ready (auto-launches if needed).

### Option 2: CLI (one-liner)
```bash
node tools/agent-capture.mjs <url> [--format=png|jpeg] [--out=path] [--visible]
```
Prints JSON: `{ "ok": true, "file": "...", "width": N, "height": M, "downscaled": bool }`

### Option 3: npm scripts
```bash
npm run agent:launch   # launch Chrome with debugging
npm run agent:serve    # start MCP server manually
```

## How capture works

1. Connect to Chrome via remote debugging (port 9222, auto-launch if needed).
2. Navigate to the URL (if provided).
3. Measure the page's full scrollable height (handles normal pages AND internal-scroll containers like CT System).
4. Walk the page screen-by-screen, capturing each viewport.
5. Hide fixed/sticky headers from the 2nd screen onward (no duplicates).
6. Stitch all captures into a single image (with automatic downscaling for huge pages).
7. Return the image as base64 (MCP) or save to disk (CLI).

## Key files

- `src/capture.ts` — capture engine (measure, scroll, capture, stitch, auto-detect dynamic content).
- `src/background.ts` — service worker (orchestration, clipboard, downloads, notifications).
- `mcp/capture.mjs` — same capture engine in Node.js for agents.
- `mcp/server.mjs` — MCP server (stdio JSON-RPC).
- `tools/agent-capture.mjs` — CLI for agents.

## Build & test

```bash
npm run check          # typecheck + build
npm run build          # build only
node tools/smoke-test.mjs --include-segments   # 12 E2E scenarios
node tools/verify-clipboard.mjs               # clipboard verification
```

## Important notes

- The extension uses NO `host_permissions` and NO content scripts. Capture is done via CDP.
- The MCP server auto-launches Chrome if not running. Sessions persist in a dedicated profile.
- For logged-in pages, the user must log in once in the agent's Chrome profile.
- Code comments are in English. User-facing messages are in Spanish.
- Do NOT add AI co-authorship to commits.