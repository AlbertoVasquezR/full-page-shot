# Full Page Shot — MCP server for AI agents

This folder exposes the same full-page capture capability to **AI agents** (Claude Code,
Cursor, etc.) via the [Model Context Protocol](https://modelcontextprotocol.io) over stdio.

It connects to a running Chrome/Edge instance through remote debugging and captures
full pages (including the user's real, logged-in session) using the same measure →
scroll → capture → stitch engine as the extension.

## Setup

1. Build the extension (so `dist/` exists):
   ```bash
   npm run build
   ```

2. Launch Chrome/Edge with the extension and remote debugging:
   ```bash
   node mcp/launch-chrome.mjs
   ```
   (Keep it running. Log in to whatever sites you need captured.)

3. Register the MCP server in your agent. For Claude Code, add to `~/.claude.json` (or project `.mcp.json`):
   ```json
   {
     "mcpServers": {
       "full-page-shot": {
         "command": "node",
         "args": ["C:/Users/.../full-page-shot/mcp/server.mjs"],
         "env": { "CHROME_DEBUG_PORT": "9222" }
       }
     }
   }
   ```

## Tools exposed

- `capture_full_page` — `{ url?, tabId?, format?, quality? }` → returns a base64 image of the entire page.
- `capture_visible` — `{ url?, format?, quality? }` → captures only the visible viewport.
- `list_tabs` — lists open tabs.
- `navigate` — navigates a tab to a URL.

## Environment variables

- `CHROME_DEBUG_PORT` — remote debugging port (default 9222).
- `DOWNLOAD_DIR` — (optional) not used by the MCP server; captures are returned inline as base64.

## Notes

- The MCP server connects to an **already running** Chrome/Edge; it does not launch one. Use `launch-chrome.mjs` (or launch Chrome yourself with `--remote-debugging-port=9222 --load-extension=.../dist`).
- Captures happen in the user's real browser session, so logged-in pages (e.g. CT System) work without re-authenticating.
- No native messaging, no registry, no Go: pure Node.js + puppeteer-core (already a dev dependency).