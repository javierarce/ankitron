// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FileDropZone, DECK_DRAG_TYPE } from "./file-drop-zone";

afterEach(cleanup);

// A minimal DataTransfer stand-in — jsdom doesn't implement drag data, so we
// hand the component the pieces it reads: `types`, `files`, and `getData`.
function makeDataTransfer({
  types,
  files = [],
  data = {},
}: {
  types: string[];
  files?: File[];
  data?: Record<string, string>;
}) {
  return {
    types,
    files,
    dropEffect: "none",
    getData: (type: string) => data[type] ?? "",
  } as unknown as DataTransfer;
}

const DECK = JSON.stringify({
  deckName: "Sample deck",
  notes: [{ modelName: "Basic", fields: { Front: "Q", Back: "A" }, tags: [] }],
});

describe("FileDropZone", () => {
  it("imports a deck handed over as a same-origin drag payload", async () => {
    const onFile = vi.fn();
    render(
      <FileDropZone onFile={onFile}>
        <div>drop here</div>
      </FileDropZone>,
    );

    const dt = makeDataTransfer({
      types: [DECK_DRAG_TYPE],
      data: { [DECK_DRAG_TYPE]: DECK },
    });
    fireEvent.drop(screen.getByText("drop here"), { dataTransfer: dt });

    expect(onFile).toHaveBeenCalledTimes(1);
    const file = onFile.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(await file.text()).toBe(DECK);
  });

  it("still imports a real dropped file", () => {
    const onFile = vi.fn();
    render(
      <FileDropZone onFile={onFile}>
        <div>drop here</div>
      </FileDropZone>,
    );

    const realFile = new File([DECK], "deck.json", { type: "application/json" });
    const dt = makeDataTransfer({ types: ["Files"], files: [realFile] });
    fireEvent.drop(screen.getByText("drop here"), { dataTransfer: dt });

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0]).toBe(realFile);
  });

  it("ignores drags that carry neither a file nor a deck payload", () => {
    const onFile = vi.fn();
    render(
      <FileDropZone onFile={onFile}>
        <div>drop here</div>
      </FileDropZone>,
    );

    // e.g. an internal chip drag that sets text/plain — must pass through.
    const dt = makeDataTransfer({ types: ["text/plain"] });
    fireEvent.drop(screen.getByText("drop here"), { dataTransfer: dt });

    expect(onFile).not.toHaveBeenCalled();
  });
});
