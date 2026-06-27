import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMediaUrl,
  mediaFilenameFromSrc,
  storeAudioFile,
} from "@/lib/audio";
import { isConfigured } from "@/lib/elevenlabs";
import { isExperimentalEnabled } from "@/lib/experimental";
import { TtsDialog } from "./tts-dialog";
import { HtmlSourceEditor } from "./html-source-editor";
import { formatHtml } from "@/lib/html-source";

// Anki stores images as bare collection-media filenames (`<img src="x.jpg">`)
// the app origin can't serve. This NodeView shows the file by resolving it to
// an object URL for display only — the node keeps `src` = filename, so
// serialization (editor.getHTML(), the source view) stays lossless and saving
// never writes a blob: URL back into the note.
const MediaImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("img");
      const { src, alt, title } = node.attrs as {
        src?: string;
        alt?: string;
        title?: string;
      };
      if (alt) dom.alt = alt;
      if (title) dom.title = title;
      const filename = src ? mediaFilenameFromSrc(src) : null;
      if (filename) {
        dom.style.opacity = "0";
        dom.style.transition = "opacity 200ms ease";
        getMediaUrl(filename).then((url) => {
          if (url) {
            dom.onload = () => {
              dom.style.opacity = "1";
            };
            dom.src = url;
          } else {
            dom.style.opacity = "1";
          }
        });
      } else if (src) {
        dom.src = src;
      }
      dom.style.borderRadius = "3px";
      // Block, not inline: an inline <img>'s line box spans the full editor
      // width, so selecting the node paints the native selection highlight into
      // the empty trailing space beside it. Block confines it to the image.
      dom.style.display = "block";
      dom.style.maxWidth = "100%";
      // No selectNode/deselectNode: letting ProseMirror toggle its own
      // `.ProseMirror-selectednode` class lets us scope the selection ring to
      // the focused editor in CSS (see globals.css), so opening the form
      // doesn't outline every editor's initially-selected image at once.
      return { dom };
    };
  },
});

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
  // The selected text the TTS dialog is open for (null = closed). The insertion
  // point is captured alongside it so opening the dialog — which drops the
  // visual selection — doesn't lose where the audio should land.
  const [ttsText, setTtsText] = useState<string | null>(null);
  const ttsInsertPos = useRef<number | null>(null);
  // The TTS button appears only when the experimental feature is enabled and an
  // ElevenLabs key is configured. Both read from non-secret localStorage flags,
  // so this is a synchronous check with no Rust round-trip on editor open.
  const [ttsAvailable] = useState(
    () => isExperimentalEnabled() && isConfigured()
  );
  // The TTS button enables only with a selection. Tracked via editor events
  // rather than read inline during render: useEditor doesn't reliably re-render
  // on selection-only changes, so an inline read would go stale and leave the
  // button stuck disabled.
  const [hasSelection, setHasSelection] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
      }),
      MediaImage,
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
      handleKeyDown: (_view, event) => {
        // Cmd/Ctrl+Enter is the form's save-and-close shortcut. Claim it here so
        // ProseMirror doesn't insert a newline first; returning true stops its
        // default, and the event still bubbles to the form, which submits.
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          return true;
        }
        return false;
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

  useEffect(() => {
    if (!editor) return;
    const sync = () => setHasSelection(!editor.state.selection.empty);
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("transaction", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("transaction", sync);
    };
  }, [editor]);

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

  const openTts = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    // textBetween with a " " block separator keeps multi-paragraph selections
    // readable as a sentence rather than gluing words across line breaks.
    const text = editor.state.doc.textBetween(from, to, " ").trim();
    if (!text) return;
    ttsInsertPos.current = to;
    setTtsText(text);
  }, [editor]);

  const insertTtsAudio = useCallback(
    (filename: string) => {
      if (!editor) return;
      // Insert at the captured selection end, clamped — mirrors handleDrop:
      // schema.text() with no marks keeps the [sound:] tag out of any bold/
      // italic formatting active at that position.
      const to = ttsInsertPos.current ?? editor.state.selection.to;
      const pos = Math.min(to, editor.state.doc.content.size);
      // Space before, none after: keeps the tag off the selected word and tight
      // against any following punctuation ("word [sound:…].").
      const node = editor.state.schema.text(` [sound:${filename}]`);
      editor.view.dispatch(editor.state.tr.insert(pos, node));
      editor.view.focus();
      setTtsText(null);
    },
    [editor]
  );

  const enterSource = useCallback(() => {
    if (!editor) return;
    // Show the parent's current value: the original imported HTML if the user
    // hasn't edited in rich mode yet, otherwise what they last produced. Pretty-
    // print it for readability — formatHtml only adds whitespace where it can't
    // change rendering, so the source stays lossless. Fall back to the raw value
    // if formatting ever throws on unexpected input.
    let formatted: string;
    try {
      formatted = formatHtml(content);
    } catch {
      formatted = content;
    }
    setSourceHtml(formatted);
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
      <div className="relative rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 bg-foreground/[0.03]">
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
        <HtmlSourceEditor
          value={sourceHtml}
          onChange={(html) => {
            setSourceHtml(html);
            onChange(html);
          }}
          placeholder={placeholder}
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
    <div className="relative rounded-lg border border-border overflow-hidden">
      <div className="flex gap-1 border-b border-border px-2 py-1.5 bg-foreground/[0.03]">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
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
          title="Italic"
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
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Insert divider"
          className="rounded px-2 py-1 text-xs text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          ―
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={addImage}
          title="Insert image by URL"
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
        {ttsAvailable && (
          <button
            type="button"
            tabIndex={-1}
            onClick={openTts}
            disabled={!hasSelection}
            className="rounded px-2 py-1 text-xs text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-foreground/50"
            title={
              hasSelection
                ? "Generate audio for the selection with ElevenLabs"
                : "Select text to generate audio"
            }
          >
            TTS
          </button>
        )}
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
      {ttsText !== null && (
        <TtsDialog
          text={ttsText}
          onInsert={insertTtsAudio}
          onClose={() => setTtsText(null)}
        />
      )}
    </div>
  );
}
