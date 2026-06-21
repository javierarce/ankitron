# Ankitron deck file format

Ankitron imports and exports decks as a single `.json` file. The format is
simple enough to write by hand or generate from another app. This document explains the structure with examples.

## The big picture

A deck file is **one JSON object** with three keys:

```json
{
  "deckName": "Spanish",
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "notes": []
}
```

| Field        | Type     | Required | Meaning                                                        |
| ------------ | -------- | -------- | ------------------------------------------------------------- |
| `deckName`   | string   | yes      | Name of the deck the cards belong to.                         |
| `exportedAt` | string   | no\*     | When the file was created, as an ISO 8601 timestamp.          |
| `notes`      | array    | yes      | The list of notes (cards). May be empty.                      |

\* `exportedAt` is written on export and is informational. You can include it
when creating a file by hand, but it isn't required for import.

> A "note" is Anki's term for a single piece of content. One note can produce
> one or more cards (for example, the "Basic (and reversed card)" type makes two
> cards from one note). For most purposes, one note = one card.

## A note

Each entry in `notes` looks like this:

```json
{
  "modelName": "Basic",
  "fields": {
    "Front": "What is the capital of France?",
    "Back": "Paris"
  },
  "tags": ["geography", "europe"]
}
```

| Field       | Type             | Required | Meaning                                                                 |
| ----------- | ---------------- | -------- | ----------------------------------------------------------------------- |
| `modelName` | string           | yes      | The Anki note type, e.g. `"Basic"` or `"Cloze"`.                        |
| `fields`    | object           | yes      | Map of field name → text. The field names depend on the note type.      |
| `tags`      | array of strings | yes      | Tags for the note. Use `[]` for none.                                   |
| `noteId`    | number           | no       | Anki's internal note ID. Present on exports; **omit it for new cards**. |
| `deck`      | string           | no       | The note's deck path (used for subdecks — see below).                   |
| `cardDecks` | array of strings | no       | Advanced: per-card deck paths. You rarely need this by hand.            |
| `mod`       | number           | no       | Last-modified time. Set automatically; don't write this by hand.        |

To create new cards, the only fields you need are `modelName`, `fields`, and
`tags`.

## Examples by note type

### Basic

`Basic` cards have a `Front` and a `Back`:

```json
{
  "modelName": "Basic",
  "fields": {
    "Front": "What year did the Berlin Wall fall?",
    "Back": "1989"
  },
  "tags": ["history"]
}
```

### Cloze

`Cloze` cards have a `Text` field with `{{c1::...}}` deletions, plus an optional
`Back Extra`:

```json
{
  "modelName": "Cloze",
  "fields": {
    "Text": "The capital of {{c1::Japan}} is {{c2::Tokyo}}.",
    "Back Extra": "Both are commonly tested."
  },
  "tags": ["geography"]
}
```

Each `{{c1::...}}`, `{{c2::...}}` group becomes its own card.

## Subdecks

If you want cards to land in a subdeck, add a `deck` field with the full path,
using `::` to separate levels:

```json
{
  "modelName": "Basic",
  "fields": { "Front": "ser vs estar", "Back": "permanent vs temporary" },
  "tags": [],
  "deck": "Spanish::Grammar"
}
```

On import, Ankitron creates the subdeck if it doesn't already exist. Notes
without a `deck` field go into the deck you choose at import time.

## A complete example

```json
{
  "deckName": "Spanish",
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "notes": [
    {
      "modelName": "Basic",
      "fields": {
        "Front": "the house",
        "Back": "la casa"
      },
      "tags": ["nouns"]
    },
    {
      "modelName": "Basic",
      "fields": {
        "Front": "to eat",
        "Back": "comer"
      },
      "tags": ["verbs"],
      "deck": "Spanish::Verbs"
    },
    {
      "modelName": "Cloze",
      "fields": {
        "Text": "Yo {{c1::como}} una manzana.",
        "Back Extra": "comer = to eat"
      },
      "tags": ["verbs"]
    }
  ]
}
```

Save this as something like `spanish.json` and import it from Ankitron.

## How import handles existing cards

- **New notes** (no `noteId`) are always added.
- **Notes with a `noteId`** that already exists in Anki are updated in place.
  When you create cards by hand, leave `noteId` out so every note
  is treated as new.
- **Tags are merged**, not replaced — importing never removes tags a note
  already has in Anki.
- **Stale-edit guard:** when updating an existing note, if its copy in Anki was
  changed more recently than the export (`mod` timestamp), Ankitron skips it to
  avoid clobbering your edits, and reports it. You can choose **Overwrite
  anyway** to force the update. This only matters for re-imports of files that
  Ankitron exported; hand-written files generally have no `noteId`/`mod` and are
  simply added.
