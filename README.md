# Anki Deck Manager

A web-based interface for managing and studying [Anki](https://apps.ankiweb.net/) decks. Built on top of the [AnkiConnect](https://foosoft.net/projects/anki-connect/) add-on, it lets you browse decks, create and edit cards, and run study sessions from the browser.

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
