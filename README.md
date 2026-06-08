# AnkiTron

A desktop interface for managing and studying [Anki](https://apps.ankiweb.net/) decks. Built on top of the [AnkiConnect](https://foosoft.net/projects/anki-connect/) add-on, it lets you browse decks, create and edit cards, and run study sessions in a native [Tauri](https://tauri.app/) window (or in the browser against the dev server).

## Features

- Browse all decks with due-card counts
- Subdeck hierarchy using the `::` separator
- Create, edit, and delete cards (Basic and Cloze note types)
- Tag management per card
- Per-deck JSON import/export — edit cards offline and re-import to update existing notes (matched by `noteId`) or add new ones
- Spaced repetition study mode driven by Anki's scheduler
- Undo the last review with `z` (or `Cmd`/`Ctrl-Z`) during study
- Launches Anki fully headless in the background on startup — no window, no Dock icon
- Light/dark theme toggle with system preference detection

## Prerequisites

1. [Anki desktop](https://apps.ankiweb.net/) must be installed. The packaged AnkiTron app launches it for you on startup; if you run the dev server (`pnpm dev`), start Anki yourself.
2. The [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on must be installed. The app talks to it at `http://127.0.0.1:8765`.

AnkiTron starts Anki headless using Qt's offscreen platform (`QT_QPA_PLATFORM=offscreen`), so Anki runs with no window and no Dock icon while AnkiConnect serves on port 8765. No accessibility/System Events permission is required. When AnkiTron quits it shuts this headless Anki down again (a background watchdog handles force-quits too), so it never leaves port 8765 blocked when you later open Anki normally.

## Install (macOS)

1. Download the latest `AnkiTron_*_universal.dmg` from the [Releases page](https://github.com/javierarce/ankitron/releases). The build is universal — it runs natively on both Apple Silicon and Intel Macs.
2. Mount the DMG and drag AnkiTron to **Applications**.
3. The first time you launch it, macOS will say "Apple could not verify AnkiTron is free of malware…" — that's expected because the build isn't notarized (no paid Apple Developer cert). To get past it: open **System Settings → Privacy & Security**, scroll to "AnkiTron was blocked from use…" and click **Open Anyway**, then re-launch and click **Open** on the next prompt.

   Or, in one terminal command:

   ```bash
   xattr -cr /Applications/AnkiTron.app
   ```

   macOS will only nag once.

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

Releases are produced by a GitHub Actions workflow on tag push (`.github/workflows/release.yml`). To cut a release, bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`, then:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push --follow-tags
```

The workflow uses [`tauri-action`](https://github.com/tauri-apps/tauri-action) on a macOS runner to build a universal `.dmg` and publish it to a GitHub Release. The build is unsigned, so first-time users need the Gatekeeper bypass described in [Install](#install-macos).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
