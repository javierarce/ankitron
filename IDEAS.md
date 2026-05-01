# Ideas

A running list of features that would be nice to add. Not prioritized — just a parking lot.

## Browsing

- **Search across cards** — filter the deck view by text or tag, and a global search in the command palette.
- **Tag filtering** — click a tag in a card row to filter the list; a simple tag manager (rename, merge, delete).
- **Bulk select / move / retag** — multi-select rows to suspend, delete, retag, or move to another deck. Anki has no "move note" UI in this app yet.
- **Rename deck** + **deck settings** (new card limit, review limit, etc.).

## Editor

- **Paste-image support** — currently the editor only inserts images by URL; clipboard paste is a big QoL win.
- **Audio support** — record or attach audio per field (Anki cards routinely use TTS or recordings).
- **Card preview** — see how the rendered card will look before saving (front/back flip).
- **Per-field formatting toolbar polish** — code formatting, lists, basic colors.

## AI

- **AI card generation** — paste a paragraph or vocabulary list, get Basic/Cloze cards back. Plays well with the Claude API and is something Anki itself doesn't do well.
- **AI-assisted cloze suggestions** — highlight the most "test-worthy" parts of a paragraph automatically.

## Stats & motivation

- **Stats panel on home** — due forecast + review heatmap (AnkiConnect exposes `getNumCardsReviewedByDay`, `getCollectionStatsHTML`, etc.).
- **Streak / daily goal indicator** in the header.

## Study mode

- **Undo last answer** within a session.
- **Progress bar / counters** for the current session.
- **Configurable answer keys** (currently 1/2/3/4).

## Discoverability & polish

- **Keyboard-shortcut help on `?`** — surface the vim nav and command palette so first-time users find them.
- **Onboarding for AnkiConnect** — already partially there in the "not connected" state; could include a "Test connection" button and detect common misconfigs.
- **Custom themes** beyond light/dark.

## Maybe-someday

- **Import from CSV / Anki package** — paste rows or drop a file to bulk-create.
- **Mobile-friendly study mode** — the desktop UX is clean; a thumb-friendly review screen would extend the use case.
- **Direct AnkiWeb sync** (no Anki desktop required) — would mean reverse-engineering AnkiWeb's protocol; big project.
