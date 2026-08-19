import { describe, it, expect } from "vitest";
import { describeSyncFailure, FULL_SYNC_MESSAGE } from "./sync-error";

describe("describeSyncFailure", () => {
  it("reads a lost connection to Anki as Anki being gone, not a network problem", () => {
    // Verbatim from the Tauri proxy when Anki has quit — and rejected as a bare
    // string, not an Error, which is exactly how it reaches us.
    const failure = describeSyncFailure(
      "AnkiConnect request failed: error sending request for url (http://127.0.0.1:8765/)",
    );

    expect(failure.kind).toBe("anki-unreachable");
    expect(failure.label).toBe("Anki isn't running");
    expect(failure.message).toMatch(/can't reach Anki/);
    // The URL and the transport wording are noise; they must not survive.
    expect(failure.message).not.toMatch(/127\.0\.0\.1|AnkiConnect request/);
    expect(failure.detail).toBeUndefined();
  });

  it("never sends the user off to open Anki themselves", () => {
    // Ankitron holds the collection with a headless Anki of its own, so an
    // instance opened by hand can't start alongside it. Copy that says "open
    // Anki" without "quit Ankitron" first is an instruction the user can't
    // follow — the reconnect has to do the work.
    const down = describeSyncFailure("AnkiConnect request failed: …");
    expect(down.message).not.toMatch(/open Anki/i);
    expect(down.message).toMatch(/Ankitron will start it/);

    for (const raw of ["sync: auth not configured", "AnkiWeb ID incorrect"]) {
      const failure = describeSyncFailure(new Error(raw));
      expect(failure.message).toMatch(/Quit Ankitron, open Anki/);
    }
  });

  it("recognises a full sync from AnkiConnect's raw refusal", () => {
    const failure = describeSyncFailure(
      new Error(
        "Sync status 2 not one of [0, 1] - see SyncCollectionResponse.ChangesRequired",
      ),
    );

    expect(failure.kind).toBe("full-sync");
    expect(failure.message).toBe(FULL_SYNC_MESSAGE);
  });

  it("still recognises a full sync after syncCollection has rewritten it", () => {
    // syncCollection rewrites the raw refusal at the throw site, so the message
    // that reaches a surface is already the friendly one — classify it the same.
    expect(describeSyncFailure(new Error(FULL_SYNC_MESSAGE)).kind).toBe(
      "full-sync",
    );
  });

  it("tells a missing AnkiWeb account from a rejected one", () => {
    const missing = describeSyncFailure(new Error("sync: auth not configured"));
    expect(missing.kind).toBe("auth");
    expect(missing.message).toMatch(/no AnkiWeb account/);

    const rejected = describeSyncFailure(
      new Error("AnkiWeb ID or password was incorrect"),
    );
    expect(rejected.kind).toBe("auth");
    expect(rejected.message).toMatch(/wouldn't accept/);
  });

  it("points at the internet connection when AnkiWeb is the one out of reach", () => {
    const failure = describeSyncFailure(new Error("network error: timed out"));

    expect(failure.kind).toBe("network");
    expect(failure.message).toMatch(/internet connection/);
  });

  it("doesn't read a status code out of the middle of a note id", () => {
    // Note and card ids are 13-digit epoch-ms numbers, so plenty of them
    // contain 401/403/502-504. Matching those as a status code would file an
    // unrecognised failure under the wrong heading and — because those branches
    // carry no `detail` — throw away the only text that could explain it.
    const network = describeSyncFailure(new Error("note 1502963982954 failed"));
    expect(network.kind).toBe("unknown");
    expect(network.detail).toBe("note 1502963982954 failed");

    const auth = describeSyncFailure(new Error("card 1403929182 is broken"));
    expect(auth.kind).toBe("unknown");

    // A real status code still lands where it should.
    expect(describeSyncFailure(new Error("HTTP 504 from AnkiWeb")).kind).toBe(
      "network",
    );
    expect(describeSyncFailure(new Error("403 Forbidden")).kind).toBe("auth");
  });

  it("keeps the raw text of a failure it can't place", () => {
    const failure = describeSyncFailure(new Error("collection is corrupt"));

    expect(failure.kind).toBe("unknown");
    expect(failure.label).toBe("Sync failed");
    // We can't explain it, so the raw text is the only clue there is.
    expect(failure.detail).toBe("collection is corrupt");
  });

  it("survives a thrown non-error with nothing useful in it", () => {
    const failure = describeSyncFailure(undefined);

    expect(failure.kind).toBe("unknown");
    expect(failure.detail).toBeUndefined();
  });
});
