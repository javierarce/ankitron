# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

A Next.js web UI for managing and studying Anki decks through the [AnkiConnect](https://foosoft.net/projects/anki-connect/) add-on. The app requires Anki desktop to be running locally with AnkiConnect listening on `http://localhost:8765`.

## Stack

- Next.js 16 (App Router) + React 19
- TypeScript
- Tailwind CSS 4
- Tiptap 3 for the rich-text card editor
- Electron 41 for the optional desktop build
- pnpm as the package manager

## Commands

- `pnpm dev` — start the dev server on port 3000
- `pnpm build` — production build
- `pnpm start` — run the production build
- `pnpm lint` — run ESLint (`eslint-config-next`)
- `pnpm electron:dev` — run Electron against the Next dev server
- `pnpm electron:build` — `next build` + `electron-builder` (output in `dist/`)
- `pnpm icons` — regenerate PNG icons from `build/icon.svg`

There is no test suite configured.

## Architecture

- `src/app/` — App Router routes. `page.tsx` lists decks; `decks/[deckName]/page.tsx` shows cards for a deck; `decks/[deckName]/study/page.tsx` runs study mode.
- `src/app/api/anki/route.ts` — server-side proxy that forwards POSTs to AnkiConnect. Use this from the browser to avoid CORS.
- `src/lib/anki-client.ts` — typed wrappers around AnkiConnect actions. **Used from server components.** Calls `http://localhost:8765` directly.
- `src/lib/anki-fetch.ts` — browser-side helpers that go through `/api/anki`.
- `src/lib/types.ts` — shared types: `AnkiResponse`, `Note`, `Card`, `Ease` (1–4 for Again/Hard/Good/Easy).
- `src/components/` — client components (deck list, card form/editor, study card, tag input, theme toggle, etc.).
- `electron/main.js` — Electron entry point. In dev it loads `http://localhost:3000`; in a packaged build it requires `.next/standalone/server.js` from `process.resourcesPath`, which self-starts on a free port, then loads that URL.
- `electron/preload.js` — context-isolated preload. No IPC bridge yet — the renderer reaches AnkiConnect through the existing `/api/anki` proxy.
- `scripts/stage-electron.mjs` — packaging prerequisite. Next's standalone output + pnpm produces isolated symlinks, so this script dereferences them into `.electron-stage/standalone/` and flattens transitive production deps out of the pnpm virtual store (`node_modules/.pnpm/...`) into a hoisted tree that Node's resolver can walk. Required because Next's standalone tracer only links top-level prod deps; transitive ones like `styled-jsx` don't come through otherwise.
- `scripts/after-pack.cjs` — electron-builder `afterPack` hook. Copies the staged `node_modules` into `<Resources>/standalone/` before code signing, because electron-builder strips `node_modules` out of `extraResources` by default.
- `build/icon.svg` — source app icon. `scripts/generate-icon.mjs` renders it into `build/icon.png` (1024px, used by electron-builder), `src/app/icon.png` (Next.js favicon), and `public/apple-touch-icon.png`. Regenerate with `pnpm icons` after editing the SVG.

## Conventions

- Subdecks use Anki's `::` separator (e.g. `Languages::Spanish::Verbs`).
- Supported note types: `Basic` (Front/Back) and `Cloze` (Text/Back Extra).
- Study mode drives Anki's own scheduler via `guiDeckReview`, `guiCurrentCard`, `guiShowAnswer`, and `guiAnswerCard`.
- Theme is persisted in `localStorage` under the key `theme`; an inline script in `layout.tsx` sets the initial class before hydration to avoid flashes.
- Server components that depend on AnkiConnect use `export const dynamic = "force-dynamic"` to disable caching.

## Working Notes

- When adding a new AnkiConnect action, add the typed wrapper to `src/lib/anki-client.ts` and mirror the browser-side helper in `anki-fetch.ts` if it is needed from a client component.
- Errors from AnkiConnect surface as `AnkiError`. The homepage treats any failure as "Anki is not running" — keep that path intact when editing error handling.
- The `.context/` directory is gitignored and used for inter-agent scratch files; do not rely on its contents in committed code.
