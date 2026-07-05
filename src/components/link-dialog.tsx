import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "./modal-dialog";

interface LinkDialogProps {
  /** Prefill for the visible text — the selection, or an existing link's text. */
  initialText: string;
  /** Prefill for the URL — an existing link's href, or a URL-looking selection. */
  initialUrl: string;
  /** True when editing an existing link (shows Remove, titles it "Edit link"). */
  editing: boolean;
  /** Commit the link. text may be empty — the caller falls back to the URL. */
  onSubmit: (text: string, url: string) => void;
  /** Strip the link, keeping its text. Only reachable while editing. */
  onRemove: () => void;
  onClose: () => void;
}

/** Two-field link editor (text + URL). The shell portals to <body> so it isn't
 * a descendant of the card <form> — otherwise Enter would submit the form and
 * its keystrokes would leak to the editor behind it. */
export function LinkDialog({
  initialText,
  initialUrl,
  editing,
  onSubmit,
  onRemove,
  onClose,
}: LinkDialogProps) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);
  const textRef = useRef<HTMLInputElement | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  // Focus the first field that still needs input: the text when there's no
  // selection to seed it, otherwise the URL (and select it so editing an
  // existing link's href is one keystroke).
  useEffect(() => {
    const el = initialText.trim() === "" ? textRef.current : urlRef.current;
    el?.focus();
    el?.select();
  }, [initialText]);

  const canSubmit = url.trim() !== "";
  function submit() {
    if (canSubmit) onSubmit(text, url);
  }

  return (
    <ModalDialog
      title={editing ? "Edit link" : "Add link"}
      onClose={onClose}
      footer={
        <div className="mt-6 flex items-center justify-end gap-3">
          {editing && (
            <button
              type="button"
              onClick={onRemove}
              className="mr-auto rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-500 transition-colors hover:bg-red-500/10"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            {editing ? "Update" : "Add"}
          </button>
        </div>
      }
    >
      <label className="mb-1 block text-xs text-foreground/50">Text</label>
      <input
        ref={textRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Link text"
        className="mb-4 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none"
      />

      <label className="mb-1 block text-xs text-foreground/50">URL</label>
      <input
        ref={urlRef}
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="https://example.com"
        spellCheck={false}
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none"
      />
    </ModalDialog>
  );
}
