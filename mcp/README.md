# Full Page Shot — MCP server for AI agents

This folder exposes the same full-page capture capability to **AI agents** (Claude Code,
Cursor, etc.) via the [Model Context Protocol](https://modelcontextprotocol.io) over stdio.

It connects to Chrome/Edge through remote debugging and captures full pages (including
the user's real, logged-in session when using their own profile) using the same
measure → scroll → capture → stitch engine as the extension.

## Setup (one-time)

1. Build the extension (so `dist/` exists):
   ```bash
   npm run build
   ```

2. Register the MCP server in your agent. For Claude Code, add to `~/.claude.json`
   (or project `.mcp.json`):
   ```json
   {
     "mcpServers": {
       "full-page-shot": {
         "command": "node",
         "args": ["C:/path/to/full-page-shot/mcp/server.mjs"]
       }
     }
   }
   ```

That's it. The server **auto-launches Chrome** with the extension and remote debugging
if it isn't already running. No manual launch step.

## How it works

- On first tool call, the server tries to connect to Chrome on port 9222.
- If nothing is listening, it launches Chrome/Edge with `--remote-debugging-port=9222`
  and `--load-extension=.../dist`, using a dedicated profile directory
  (`%LOCALAPPDATA%/full-page-shot-agent-profile` on Windows).
- The agent can then call `capture_full_page({ url })` and receive the image as base64.

## Tools exposed

- `capture_full_page` — `{ url?, tabId?, format?, quality? }` → base64 image of the entire page.
- `capture_visible` — `{ url?, format?, quality? }` → captures only the visible viewport.
- `list_tabs` — lists open tabs.
- `navigate` — navigates a tab to a URL.

## Environment variables

- `CHROME_DEBUG_PORT` — remote debugging port (default 9222).
- `CHROME_PROFILE_DIR` — profile directory to use (default: a dedicated agent profile).

## Notes

- The first run opens a Chrome window. **Log in to whatever sites you need** in that
  window; the session persists in the agent profile for future runs.
- To use your **existing** Chrome profile (with all your logins), close your normal
  Chrome first and set `CHROME_PROFILE_DIR` to your profile path, then restart the server.
- Captures happen in the real browser, so logged-in pages (e.g. CT System) work.
- No native messaging, no registry, no Go: pure Node.js + puppeteer-core (already a dev dependency).
- If you already have Chrome running with `--remote-debugging-port=9222`, the server
  connects to it instead of launching a new one.