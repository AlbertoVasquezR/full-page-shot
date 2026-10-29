# Contributing to Full Page Shot

Thanks for your interest! This document explains how to contribute.

## Requirements

- Node.js 18+
- Microsoft Edge (for end-to-end tests)
- Git

## Environment setup

```powershell
git clone https://github.com/AlbertoVasquezR/full-page-shot.git
cd full-page-shot
npm install
npm run build
```

Load the extension in Edge from `edge://extensions/` → **Developer mode** → **Load unpacked** → select `dist/`.

## Workflow

1. Create a branch: `git checkout -b feat/my-improvement`
2. Make your changes.
3. Verify types and build: `npm run check`
4. Run the tests:
   - `node tools/smoke-test.mjs` (end-to-end)
   - `node tools/verify-clipboard.mjs` (clipboard)
5. Commit with a clear message.
6. Open a Pull Request.

## Code conventions

- **Strict TypeScript** (`strict: true`), no plain JavaScript.
- **esbuild** as the only bundler.
- Comments and user-facing messages in **Spanish**.
- Function/variable names in **camelCase** English (TypeScript style).
- Don't add `host_permissions` or content scripts: capture is done via CDP.
- If you add a new option: update `types.ts`, `settings.ts`, `options.html/.ts`, the popup if applicable, and the README.

## Tests

- `npm run typecheck` — types only.
- `npm run check` — types + build.
- `node tools/smoke-test.mjs` — launches real Edge, captures long pages, checks PNG/JPEG.
  - `--include-segments` adds 65,000 px and 20,000 px scroll scenarios.
  - `--only=scroll` filters by name.
  - `--keep` keeps the downloads.
- `node tools/verify-clipboard.mjs` — verifies the clipboard really receives a PNG image.

## Commits

- Descriptive messages in Spanish or English.
- **Don't add AI co-authorship** (no `Co-authored-by` trailers from models).
- One commit per logical change.

## Reporting bugs

Open an issue with:
- Steps to reproduce.
- Affected page (URL if public).
- Console output (if applicable).
- Edge version and operating system.

## Code of conduct

Be respectful and constructive. This is a personal project; technical criticism is welcome, personal attacks are not.