# AnkiTron

A desktop and web interface for managing and studying [Anki](https://apps.ankiweb.net/) decks — Anki via [Elec]Tron. Built on top of the [AnkiConnect](https://foosoft.net/projects/anki-connect/) add-on, it lets you browse decks, create and edit cards, and run study sessions from the browser or as a packaged Electron app.

## Features

- Browse all decks with due-card counts
- Subdeck hierarchy using the `::` separator
- Create, edit, and delete cards (Basic and Cloze note types)
- Tag management per card
- Spaced repetition study mode driven by Anki's scheduler
- Light/dark theme toggle with system preference detection

## Prerequisites

1. [Anki desktop](https://apps.ankiweb.net/) must be installed and running.
2. The [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on must be installed. The app talks to it at `http://localhost:8765`.

## Install (macOS)

1. Download the latest `AnkiTron-*-arm64.dmg` from the [Releases page](https://github.com/javierarce/ankitron/releases).
2. Mount the DMG and drag AnkiTron to **Applications**.
3. The first time you launch it, macOS will say "Apple could not verify AnkiTron is free of malware…" — that's expected because the build isn't notarized (no paid Apple Developer cert). To get past it: open **System Settings → Privacy & Security**, scroll to "AnkiTron was blocked from use…" and click **Open Anyway**, then re-launch and click **Open** on the next prompt.

   Or, in one terminal command:

   ```bash
   xattr -cr /Applications/AnkiTron.app
   ```

   macOS will only nag once.

## Getting Started

Install dependencies and start the dev server:

```bash
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000).

With Anki running, the homepage lists your decks. Without it, you will see a connection error — launch Anki and reload.

## Scripts

- `pnpm dev` — start the Next.js dev server
- `pnpm build` — production build
- `pnpm start` — serve the production build
- `pnpm lint` — run ESLint
- `pnpm electron:dev` — run the app as an Electron desktop window against the Next.js dev server
- `pnpm electron:build` — build the Next app and package an Electron binary with `electron-builder` (output in `dist/`)
- `pnpm icons` — regenerate PNG icons from `build/icon.svg` (app icon + favicon)

## Tech Stack

- [Next.js 16](https://nextjs.org/) (App Router, React 19)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Tiptap](https://tiptap.dev/) for the rich-text card editor
- TypeScript
- [Electron](https://www.electronjs.org/) for the optional desktop build

## Project Structure

```
src/
  app/                Next.js routes (home, deck pages, study mode, API proxy)
  components/         UI components (deck list, card editor, study card, etc.)
  lib/
    anki-client.ts    Typed wrappers for AnkiConnect actions
    anki-fetch.ts     Browser-side fetch helpers
    types.ts          Shared types (Note, Card, AnkiResponse, Ease)
electron/
  main.js             Electron main process (BrowserWindow, loads Next in dev/prod)
  preload.js          Preload script (context-isolated, currently a no-op)
build/
  icon.svg            Source app icon
  icon.png            Rendered 1024px icon (used by electron-builder)
scripts/
  generate-icon.mjs   Renders icon.svg → PNGs (app icon + favicon)
  stage-electron.mjs  Stages Next's standalone output (flattens pnpm tree)
  after-pack.cjs      electron-builder afterPack hook (injects node_modules)
```

The `src/app/api/anki` route proxies requests to AnkiConnect to avoid CORS issues from the browser.

## Releasing

Releases are produced by a GitHub Actions workflow on tag push (`.github/workflows/release.yml`). To cut a release:

```bash
pnpm version patch        # bumps package.json + creates a v* tag
git push --follow-tags    # pushes the commit and the tag
```

The workflow runs `electron-builder` on a macOS runner and uploads the unsigned DMG as a draft GitHub Release. Open the [Releases page](https://github.com/javierarce/ankitron/releases), review the draft, and publish it. Because the build is unsigned, first-time users will need to right-click → Open to bypass Gatekeeper.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
