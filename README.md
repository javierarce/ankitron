# Ankitron

[![Latest release](https://img.shields.io/github/v/release/javierarce/ankitron?label=latest%20release)](https://github.com/javierarce/ankitron/releases/latest)


A simple, lightweight Mac app for managing and studying [Anki](https://apps.ankiweb.net) decks. Browse decks, create and edit notes, and run study sessions in a simple and clean interface.

<img width="2800" height="2048" alt="image" src="https://github.com/user-attachments/assets/9e1f1988-b034-401d-a482-b2b7a6158032" />

## Features

**Decks**
- Browse all decks with new/learning/review due counts.
- Create, rename, and move decks and subdecks.

**Notes**
- Create, edit, and delete notes in four note types: Basic, Basic (and reversed), Cloze, and Cloze (typed)
- Rich-text editor with bold, italic, lists, image insertion, and a cloze helper (with hints)
- Toggle a raw HTML source view to edit the underlying markup
- Add and remove tags
- Suspend and unsuspend cards
- Bulk-select notes to delete, move, suspend, or edit them one at a time in sequence

**Audio**
- `[sound:…]` audio plays during study — automatically and via inline play buttons (`R` to replay)
- Attach audio to a note by dragging a file onto the editor or picking one

**Sync, import & more**
- JSON import/export — edit decks offline and re-import them to update existing notes or add new ones (see the [deck file format](docs/deck-file-format.md))
- Manual "Sync now", plus automatic sync on launch and after each session
- Command palette (`Cmd`/`Ctrl-K`) to jump between decks or add a note, with vim-style `j`/`k` navigation throughout
- Light/dark theme toggle with system-preference detection
- Built-in update checks.

## Prerequisites

Before launching Ankitron install the latest [Anki desktop](https://apps.ankiweb.net) app and the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on.

## Installation (macOS)

1. Download **[Ankitron.dmg](https://github.com/javierarce/ankitron/releases/latest/download/Ankitron.dmg)**.
2. Mount the DMG, drag Ankitron to **Applications**, and launch it.

## Why only two answer buttons?

Anki shows four answer buttons (Again, Hard, Good, Easy), but Ankitron deliberately shows two: **Fail** and **Pass**, mapped to Anki's Again and Good. Pass/fail grading is a long-standing practice among experienced Anki users, and the data supports it: an [analysis by an FSRS researcher](https://forums.ankiweb.net/t/pass-fail-grading-as-default/34147/120) across thousands of collections found no statistically significant difference in scheduling accuracy between two-button and four-button users.

Two buttons also remove the most common grading mistake: pressing Hard when you actually forgot. Anki's schedulers treat Hard as a *pass* (recalled with hesitation), so misusing it inflates intervals — a [known enough problem](https://github.com/open-spaced-repetition/fsrs4anki/wiki) that the FSRS Helper add-on ships a remedy for it. With pass/fail, that mistake can't happen, and you spend your time recalling instead of deciding how well you recalled.

# Ankitron Keyboard Shortcuts

## Global

| Shortcut | Action |
| --- | --- |
| `Cmd` + `K` | Open the command palette |
| `Cmd` + `N` | New note |
| `Cmd` + `,` | Open settings |
| `Cmd` + `1` | Go to Study |
| `Cmd` + `2` | Go to Decks |

## Command palette (when open)

| Shortcut | Action |
| --- | --- |
| `↑` / `↓` | Move the selection |
| `Enter` | Open the selected deck / run the action |
| `Esc` | Go back a level, or close the palette |

## List navigation 

| Shortcut | Action |
| --- | --- |
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `g` `g` | Jump to the top (press `g` twice within 500 ms) |
| `G` (`Shift` + `g`) | Jump to the bottom |
| `l` / `→` | Expand the focused deck (in the deck list) |
| `h` / `←` | Collapse the focused deck, or jump to its parent (in the deck list) |

## Decks page

| Shortcut | Action |
| --- | --- |
| `Cmd` + `F` or `/` | Focus the search box |

## Note list (deck detail)

| Shortcut | Action |
| --- | --- |
| `Cmd` + `F` or `/` | Focus the search box |
| `Cmd` + `A` | Select all notes |
| `Space` | Toggle selection of the focused note |
| `Shift` + `J` / `Shift` + `K` | Move down/up, extending the selection |
| `a` | Add a new note |
| `e` | Edit the selected notes in sequence (or the focused note if none are selected) |
| `t` | Add or remove tags on the selected notes (or the focused note if none are selected) |
| `Cmd` + `Z` | Undo the last tag change |


## Study session

| Shortcut | Action |
| --- | --- |
| `Space`, `1`, or `2` | Reveal the answer |
| `1` | Grade **Fail** (after reveal) |
| `Space` or `2` | Grade **Pass** (after reveal) |
| `r` | Play the card's audio (answer side once revealed, otherwise the question) |
| `e` | Edit the current note |
| `a` | Add a note to the session |
| `Cmd` + `←` | Return to the deck (confirms once you've started reviewing) |
| `Cmd` + `Z` | Undo the last review |


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, project structure, and the release process.

## Disclaimer

Ankitron is an unofficial third-party app and is not affiliated with the official Anki project or Ankitects Pty Ltd.

Use at your own risk. The developer is not responsible for any data loss or synchronization errors with your AnkiWeb account.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
