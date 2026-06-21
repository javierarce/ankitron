# TODO

Deferred features, with enough context to pick them up later.

## Audio in JSON import/export

JSON exports carry `[sound:…]` references but not the files, so a deck shared
with someone else loses its audio. Plan: keep plain `.json` as the default and
add an "Export with media" variant — a zip containing `deck.json` plus a
`media/` directory. Export collects referenced files via `retrieveMediaFile`;
import stores them with `storeMediaFile` (skip if identical, rename and
rewrite references on collision) before upserting notes.

Note: for plain deck sharing (not offline editing), `exportPackage` /
`importPackage` already produce/consume standard `.apkg` files with media
bundled by Anki itself — consider exposing those first; the zip format is
only needed for media-bearing decks that should stay hand/LLM-editable.

## Clean up unused media

Removing a `[sound:…]` tag (or deleting a note) orphans the file in
`collection.media`, where it syncs forever. Anki's answer is the manual
Tools → Check Media. If this becomes a real annoyance, add a single
"Clean up unused media" action (next to the danger zone, not a full media
manager): list files via `getMediaFilesNames`, scan all note fields for
`[sound:…]` and `<img src>` references in batches, diff — skipping
underscore-prefixed files, which Anki treats as intentionally unreferenced
(used by templates/CSS) — then preview orphans with the existing audio
player and delete confirmed ones via `deleteMediaFile`.
