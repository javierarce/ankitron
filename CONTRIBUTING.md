## Getting Started

Install dependencies and start the Vite dev server (browser UI):

```bash
pnpm install
pnpm dev
```

Then open [http://localhost:5173](http://localhost:5173).

To run the native desktop app against the dev server (this also auto-launches headless Anki):

```bash
pnpm dev:tauri
```

In plain `pnpm dev` (browser) mode, Anki must already be running — only the Tauri build auto-launches it. If AnkiConnect isn't reachable, you will see a connection error.

## Scripts

- `pnpm dev` — start the Vite dev server (browser UI)
- `pnpm dev:tauri` — run the native Tauri desktop app against the dev server
- `pnpm build` — production build of the web assets (Vite, output in `dist/`)
- `pnpm build:tauri` — build and bundle the native app (`.app`/`.dmg`)
- `pnpm preview` — preview the production web build
- `pnpm lint` — run ESLint
- `pnpm test` — run the Vitest unit suite (`pnpm test:watch` for watch mode)
- `pnpm icons` — regenerate PNG icons from `build/icon.svg`

## Tech Stack

- [Tauri v2](https://tauri.app/) (Rust) for the native desktop shell
- [Vite](https://vite.dev/) + [React 19](https://react.dev/) + [React Router](https://reactrouter.com/)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Tiptap](https://tiptap.dev/) for the rich-text card editor
- TypeScript

## Project Structure

```
src/                  Frontend (Vite + React)
  main.tsx            App entry (router + global styles)
  layout.tsx          App shell / layout
  pages/              Route views (home, decks, deck detail, study)
  components/         UI components (deck list, card editor, study card, etc.)
  hooks/              Custom hooks (e.g. vim-style navigation)
  lib/
    anki-fetch.ts     AnkiConnect request helpers
    import-export.ts  Per-deck JSON import/export
    types.ts          Shared types (Note, Card, AnkiResponse, Ease)
src-tauri/            Native shell (Rust)
  src/main.rs         Tauri app, AnkiConnect proxy command, lifecycle
  src/anki.rs         Locate + launch/stop headless Anki
  tauri.conf.json     Bundle, window, and security config
build/
  icon.svg            Source app icon
scripts/
  generate-icon.mjs   Renders icon.svg → PNGs
```

Requests to AnkiConnect are proxied through the Rust `anki_request` command (invoked from the frontend) to avoid CORS issues from the WebView.

## Releasing

Releases are produced by a GitHub Actions workflow on tag push (`.github/workflows/release.yml`). To cut a release, bump the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`, then:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push --follow-tags
```

The workflow uses [`tauri-action`](https://github.com/tauri-apps/tauri-action) on a macOS runner to build a universal `.dmg`, sign it with the Developer ID certificate, notarize it with Apple (both the app and the dmg), and publish it to a GitHub Release. The signing certificate and App Store Connect API key are stored as repository secrets.
