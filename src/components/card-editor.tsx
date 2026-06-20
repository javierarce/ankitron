import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useCallback, useRef, useState } from "react";
import { storeAudioFile } from "@/lib/audio";

interface CardEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  clozeMode?: boolean;
}

function getNextClozeNumber(html: string): number {
  const matches = html.match(/\{\{c(\d+)::/g);
  if (!matches) return 1;
  const numbers = matches.map((m) => parseInt(m.replace("{{c", "").replace("::", "")));
  return Math.max(...numbers) + 1;
}

// Collapse insignificant whitespace so the rich/source fidelity check doesn't
// flag harmless reformatting (TipTap re-indents and re-wraps on serialize).
function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
}

export function CardEditor({ content, onChange, placeholder, clozeMode }: CardEditorProps) {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [attachingAudio, setAttachingAudio] = useState(false);
  // Source mode swaps the WYSIWYG editor for a raw-HTML textarea. The textarea
  // is the lossless path: its contents are written to the parent verbatim,
  // bypassing TipTap's schema (which silently drops tables, styles, custom
  // tags, etc.). Seeded from `content` rather than editor.getHTML() so it shows
  // the original imported HTML before TipTap had a chance to degrade it.
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceHtml, setSourceHtml] = useState("");

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Image,
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[100px] px-3 py-2 text-sm focus:outline-none prose prose-sm dark:prose-invert max-w-none",
      },
      handleDrop: (view, event, _slice, moved) => {
        // Let ProseMirror handle internal node drags (e.g. moving an image).
        if (moved) return false;
        const files = event.dataTransfer?.files;
        const audio =
          files && Array.from(files).find((f) => f.type.startsWith("audio/"));
        if (!audio) return false;
        event.preventDefault();
        // Insert at the drop point rather than the cursor.
        const dropPos =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
          view.state.selection.from;
        setAttachingAudio(true);
        storeAudioFile(audio)
          .then((filename) => {
            // schema.text() with no marks keeps the [sound:] tag out of any
            // bold/italic formatting active at the drop position.
            const pos = Math.min(dropPos, view.state.doc.content.size);
            const node = view.state.schema.text(`[sound:${filename}] `);
            view.dispatch(view.state.tr.insert(pos, node));
            view.focus();
          })
          .catch(() => {
            window.alert(
              "Could not attach the audio file. Make sure Anki is running."
            );
          })
          .finally(() => setAttachingAudio(false));
        return true;
      },
    },
  });

  const addImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("Image URL:");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  const handleAudioFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so picking the same file again re-triggers onChange.
      e.target.value = "";
      if (!file || !editor) return;
      setAttachingAudio(true);
      try {
        // The file lands in Anki's media folder, so it syncs to AnkiWeb and
        // mobile along with the note.
        const filename = await storeAudioFile(file);
        // insertContent routes text through tr.insertText, which applies the
        // marks active at the cursor — attaching right after formatted text
        // would wrap the tag in <strong>/<em>. Empty storedMarks ([], not
        // null) override that lookup for this transaction.
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.setStoredMarks([]);
            return true;
          })
          .insertContent(`[sound:${filename}] `)
          .run();
      } catch {
        window.alert("Could not attach the audio file. Make sure Anki is running.");
      } finally {
        setAttachingAudio(false);
      }
    },
    [editor]
  );

  const insertCloze = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);
    const currentHtml = editor.getHTML();
    const n = getNextClozeNumber(currentHtml);

    if (selectedText) {
      const pipeIdx = selectedText.indexOf("|");
      const body =
        pipeIdx === -1
          ? selectedText
          : `${selectedText.slice(0, pipeIdx)}::${selectedText.slice(pipeIdx + 1)}`;
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, `{{c${n}::${body}}}`)
        .run();
    } else {
      editor
        .chain()
        .focus()
        .insertContent(`{{c${n}::}}`)
        .run();
      // Move cursor inside the cloze (before the closing }})
      const pos = editor.state.selection.from - 2;
      editor.chain().setTextSelection(pos).run();
    }
  }, [editor]);

  const enterSource = useCallback(() => {
    if (!editor) return;
    // Show the parent's current value: the original imported HTML if the user
    // hasn't edited in rich mode yet, otherwise what they last produced.
    setSourceHtml(content);
    setSourceMode(true);
  }, [editor, content]);

  const leaveSource = useCallback(() => {
    if (!editor) return;
    // Re-parse the raw HTML through TipTap to return to WYSIWYG. Anything the
    // schema can't represent is dropped here, so warn before committing.
    editor.commands.setContent(sourceHtml, { emitUpdate: false });
    const rich = editor.getHTML();
    if (normalizeHtml(rich) !== normalizeHtml(sourceHtml)) {
      const ok = window.confirm(
        "Rich text mode can't represent some of this HTML (e.g. tables, inline styles, custom tags), so switching may simplify it. Switch anyway?"
      );
      if (!ok) return; // Stay in source; parent state keeps the verbatim HTML.
    }
    onChange(editor.getHTML());
    setSourceMode(false);
  }, [editor, sourceHtml, onChange]);

  if (!editor) return null;

  if (sourceMode) {
    return (
      <div className="relative rounded-lg border border-foreground/15 overflow-hidden">
        <div className="flex items-center gap-1 border-b border-foreground/10 px-2 py-1.5 bg-foreground/[0.03]">
          <span className="px-1 text-xs font-medium text-foreground/40">HTML</span>
          <button
            type="button"
            tabIndex={-1}
            onClick={leaveSource}
            className="ml-auto rounded px-2 py-1 text-xs font-medium bg-foreground/15 text-foreground transition-colors"
            title="Back to rich text editing"
          >
            {"</>"}
          </button>
        </div>
        <textarea
          value={sourceHtml}
          onChange={(e) => {
            setSourceHtml(e.target.value);
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          spellCheck={false}
          className="block w-full resize-y min-h-[100px] max-h-[240px] px-3 py-2 font-mono text-xs leading-relaxed bg-transparent focus:outline-none placeholder:text-foreground/30"
        />
      </div>
    );
  }

  const doc = editor.state.doc;
  const isTrulyEmpty =
    doc.childCount === 1 &&
    doc.firstChild?.type.name === "paragraph" &&
    doc.firstChild.content.size === 0;

  return (
    <div className="relative rounded-lg border border-foreground/15 overflow-hidden">
      <div className="flex gap-1 border-b border-foreground/10 px-2 py-1.5 bg-foreground/[0.03]">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`rounded px-2 py-1 text-xs font-bold transition-colors ${
            editor.isActive("bold")
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
          }`}
        >
          B
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`rounded px-2 py-1 text-xs italic transition-colors ${
            editor.isActive("italic")
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
          }`}
        >
          I
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`rounded px-2 py-1 text-xs transition-colors ${
            editor.isActive("bulletList")
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
          }`}
          title="Bullet list"
        >
          •
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`rounded px-2 py-1 text-xs transition-colors ${
            editor.isActive("orderedList")
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
          }`}
          title="Numbered list"
        >
          1.
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={addImage}
          className="rounded px-2 py-1 text-xs text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          IMG
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => audioInputRef.current?.click()}
          disabled={attachingAudio}
          className="rounded px-2 py-1 text-xs text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-50"
          title="Attach an audio file"
        >
          {attachingAudio ? "…" : "AUD"}
        </button>
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleAudioFile}
        />
        {clozeMode && (
          <button
            type="button"
            tabIndex={-1}
            onClick={insertCloze}
            className="rounded px-2 py-1 text-xs font-medium text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
            title="Wrap selection in cloze deletion. Use 'answer|hint' to add a hint."
          >
            [...]
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          onClick={enterSource}
          className="ml-auto rounded px-2 py-1 text-xs font-mono text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
          title="Edit raw HTML"
        >
          {"</>"}
        </button>
      </div>
      <div className="relative max-h-[160px] overflow-y-auto">
        {placeholder && isTrulyEmpty && (
          <div className="pointer-events-none absolute left-0 top-0 px-3 py-2 text-sm text-foreground/30">
            {placeholder}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
