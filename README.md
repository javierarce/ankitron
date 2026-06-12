# AnkiTron

[![Latest release](https://img.shields.io/github/v/release/javierarce/ankitron?label=latest%20release)](https://github.com/javierarce/ankitron/releases/latest)

A mac app for managing and studying [Anki](https://apps.ankiweb.net) decks. Browse decks, create and edit cards, and run study sessions in a simple and clean interface.

<img width="2800" height="2048" alt="image" src="https://github.com/user-attachments/assets/9e1f1988-b034-401d-a482-b2b7a6158032" />

## Features

- Browse all decks with due-card counts
- Create, edit, and delete cards (Basic and Cloze note types)
- Move cards between decks
- See and manage card tags
- Card audio: `[sound:…]` files play during study (automatically and via inline play buttons, `R` to replay), and audio files can be attached from the editor
- JSON import/export — edit decks offline and re-import them to update existing notes or add new ones (see the [deck file format](docs/deck-file-format.md))
- Undo the last review with `Cmd`/`Ctrl-Z` during study
- Light/dark theme toggle with system preference detection
- Navigate between decks using the command palette with `Cmd`/`Ctrl-K`

## Why only two answer buttons?

Anki shows four answer buttons (Again, Hard, Good, Easy), but AnkiTron deliberately shows two: **Fail** and **Pass**, mapped to Anki's Again and Good. Pass/fail grading is a long-standing practice among experienced Anki users, and the data supports it: an [analysis by an FSRS researcher](https://forums.ankiweb.net/t/pass-fail-grading-as-default/34147/120) across thousands of collections found no statistically significant difference in scheduling accuracy between two-button and four-button users.

Two buttons also remove the most common grading mistake: pressing Hard when you actually forgot. Anki's schedulers treat Hard as a *pass* (recalled with hesitation), so misusing it inflates intervals — a [known enough problem](https://github.com/open-spaced-repetition/fsrs4anki/wiki) that the FSRS Helper add-on ships a remedy for it. With pass/fail, that mistake can't happen, and you spend your time recalling instead of deciding how well you recalled.

## Prerequisites

Before launching AnkiTron install the latest [Anki desktop](https://apps.ankiweb.net) app and the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on.

## Installation (macOS)

1. Download **[AnkiTron.dmg](https://github.com/javierarce/ankitron/releases/latest/download/AnkiTron.dmg)**.
2. Mount the DMG, drag AnkiTron to **Applications**, and launch it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, project structure, and the release process.

## Disclaimer

AnkiTron is an unofficial third-party app and is not affiliated with the official Anki project or Ankitects Pty Ltd.

Use at your own risk. The developer is not responsible for any data loss or synchronization errors with your AnkiWeb account.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
