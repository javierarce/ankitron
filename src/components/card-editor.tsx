import { useEditor, EditorContent, getMarkRange } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMediaUrl,
  mediaFilenameFromSrc,
  storeAudioFile,
  storeImageFile,
} from "@/lib/audio";
import { isConfigured } from "@/lib/elevenlabs";
import { isExperimentalEnabled } from "@/lib/experimental";
import { TtsDialog } from "./tts-dialog";
import { LinkDialog } from "./link-dialog";
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

// TipTap's setLink stores the href verbatim (defaultProtocol only participates
// in autolink/paste, never rewriting it), so a bare "example.com" would be a
// relative href that resolves against the app's tauri:// origin at click time
// and goes nowhere. Prepend a scheme when the input lacks one.
function normalizeLinkHref(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  // Protocol-relative (//host): give it https so it doesn't inherit tauri://.
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  // Already has a scheme (https:, mailto:, tel:, …)? Leave it alone.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Whether a selection is itself a URL, so highlighting a pasted link and hitting
// the link button pre-fills the field with it. A scheme (https:, mailto:…) or a
// bare dotted host with no whitespace ("example.com/path").
function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(t) || /^[\w-]+(\.[\w-]+)+/.test(t);
}

// Collapse insignificant whitespace so the rich/source fidelity check doesn't
// flag harmless reformatting (TipTap re-indents and re-wraps on serialize).
function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
}

export function CardEditor({ content, onChange, placeholder, clozeMode }: CardEditorProps) {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [attachingAudio, setAttachingAudio] = useState(false);
  const [attachingImage, setAttachingImage] = useState(false);
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
  // Mirror of "is the TTS dialog open", readable inside the editor's stable
  // handleKeyDown closure (created once). While it's open the editor must ignore
  // keys: focus can drift back here — e.g. when generating disables the dialog's
  // focused control — and a stray Enter would otherwise replace the highlighted
  // selection.
  const ttsOpenRef = useRef(false);
  useEffect(() => {
    ttsOpenRef.current = ttsText !== null;
  }, [ttsText]);
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
  // Whether the cursor sits inside a link, driving the link button's active
  // highlight. Tracked via editor events for the same reason as hasSelection:
  // useEditor doesn't re-render on selection-only moves (e.g. arrow keys), so
  // reading editor.isActive("link") inline during render would go stale.
  const [isLinkActive, setIsLinkActive] = useState(false);
  // The link editor is a modal (LinkDialog) with text + URL fields; null means
  // closed. Opening it captures the target range up front, since focusing the
  // dialog drops the editor's selection. `editing` distinguishes updating an
  // existing link (whose full mark range is captured) from creating one.
  const [linkDialog, setLinkDialog] = useState<{
    from: number;
    to: number;
    text: string;
    url: string;
    editing: boolean;
  } | null>(null);
  // editorProps is built once when the editor mounts, before openLink exists,
  // so the click handler calls through a ref that's kept pointing at the latest.
  const openLinkRef = useRef<(pos?: number) => void>(() => {});

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        // StarterKit bundles the Link mark (so imported <a> tags round-trip).
        // openOnClick would navigate the webview away from the app when a link
        // is clicked mid-edit, so disable it — the link button manages links
        // instead. defaultProtocol only governs autolink/paste (setLink stores
        // the href verbatim — see normalizeLinkHref), so "https" makes a URL
        // typed inline resolve absolutely rather than against tauri://.
        link: {
          openOnClick: false,
          defaultProtocol: "https",
        },
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
        // While the TTS dialog is open the editor stays inert so a stray focus
        // return can't mutate the card behind it. Swallow every key (preventing
        // the newline) and stop it bubbling to the form (preventing Cmd+Enter
        // save) — except Escape, which must reach the dialog's close handler.
        if (ttsOpenRef.current) {
          if (event.key === "Escape") return false;
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
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
      handleDOMEvents: {
        // WKWebView natively follows an <a> click inside contenteditable
        // (Chrome/Firefox just place the cursor), navigating the app away, and
        // preventDefault on the *click* event doesn't stop it. Cancelling the
        // gesture at mousedown does. We compute the clicked position here (the
        // caret never moves, since we prevent the default) and open the link
        // editor for that link. Left button only, so right/ctrl-click still get
        // the context menu.
        mousedown: (view, event) => {
          if (event.button !== 0) return false;
          const link = (event.target as HTMLElement | null)?.closest("a");
          if (!link) return false;
          event.preventDefault();
          const pos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })?.pos;
          openLinkRef.current(pos);
          return true;
        },
        // Belt-and-suspenders: swallow the click default for links too, in case
        // a drag or focus quirk lets one through despite the mousedown cancel.
        click: (_view, event) => {
          if (!(event.target as HTMLElement | null)?.closest("a")) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      setHasSelection(!editor.state.selection.empty);
      setIsLinkActive(editor.isActive("link"));
    };
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("transaction", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("transaction", sync);
    };
  }, [editor]);

  const handleImageFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so picking the same file again re-triggers onChange.
      e.target.value = "";
      if (!file || !editor) return;
      setAttachingImage(true);
      try {
        // Store the file in Anki's media folder so it syncs to AnkiWeb and
        // mobile with the note. setImage gets the bare filename, which the
        // MediaImage NodeView resolves to a displayable URL — and serialization
        // keeps `src` = filename, so saving writes a valid Anki <img>.
        const filename = await storeImageFile(file);
        editor.chain().focus().setImage({ src: filename }).run();
      } catch {
        window.alert("Could not attach the image. Make sure Anki is running.");
      } finally {
        setAttachingImage(false);
      }
    },
    [editor]
  );

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

  const openLink = useCallback((pos?: number) => {
    if (!editor) return;
    const { state } = editor;
    const linkType = state.schema.marks.link;
    // A link click passes the clicked position (the selection isn't moved
    // there — we cancel the mousedown to stop WebKit navigating); the toolbar
    // button passes nothing and works off the current selection.
    const $pos = pos != null ? state.doc.resolve(pos) : state.selection.$from;
    // A cursor anywhere inside a link edits that whole link: expand to its mark
    // range so text/URL prefill from — and Update/Remove act on — the full link.
    const range = linkType ? getMarkRange($pos, linkType) : undefined;
    if (range) {
      let href = "";
      state.doc.nodesBetween(range.from, range.to, (node) => {
        const mark = node.marks.find((m) => m.type === linkType);
        if (mark) href = (mark.attrs.href as string) ?? "";
      });
      setLinkDialog({
        from: range.from,
        to: range.to,
        text: state.doc.textBetween(range.from, range.to),
        url: href,
        editing: true,
      });
      return;
    }
    // No link: seed the text from the selection, and the URL too when the
    // selection already looks like a pasted address.
    const { from, to } = state.selection;
    const selectedText = state.doc.textBetween(from, to);
    setLinkDialog({
      from,
      to,
      text: selectedText,
      url: looksLikeUrl(selectedText) ? selectedText : "",
      editing: false,
    });
  }, [editor]);

  // Keep the click handler (bound once in editorProps) calling the current
  // openLink so it opens the dialog for whatever link was tapped.
  useEffect(() => {
    openLinkRef.current = openLink;
  }, [openLink]);

  const submitLink = useCallback(
    (text: string, url: string) => {
      if (!editor || !linkDialog) return;
      const href = normalizeLinkHref(url);
      if (href === "") return; // URL required (the dialog also guards this).
      // Empty text falls back to the URL so there's always something to show.
      const label = text.trim() === "" ? href : text;
      // Replace the captured range with the linked text — covers inserting at a
      // cursor, linking a selection, and rewriting an existing link's text/href.
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: linkDialog.from, to: linkDialog.to },
          { type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }
        )
        .run();
      setLinkDialog(null);
    },
    [editor, linkDialog]
  );

  const removeLink = useCallback(() => {
    if (!editor || !linkDialog) return;
    // The captured range is the full link, so unset over it strips the link and
    // keeps the text.
    editor
      .chain()
      .focus()
      .setTextSelection({ from: linkDialog.from, to: linkDialog.to })
      .unsetLink()
      .run();
    setLinkDialog(null);
  }, [editor, linkDialog]);

  const closeLink = useCallback(() => {
    setLinkDialog(null);
    editor?.commands.focus();
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
          onClick={() => openLink()}
          title="Add or edit a link"
          className={`rounded px-2 py-1 transition-colors ${
            isLinkActive
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
          }`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
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
          onClick={() => imageInputRef.current?.click()}
          disabled={attachingImage}
          title="Attach an image"
          className="rounded px-2 py-1 text-xs text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-50"
        >
          {attachingImage ? "…" : "IMG"}
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageFile}
        />
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
      {linkDialog && (
        <LinkDialog
          initialText={linkDialog.text}
          initialUrl={linkDialog.url}
          editing={linkDialog.editing}
          onSubmit={submitLink}
          onRemove={removeLink}
          onClose={closeLink}
        />
      )}
    </div>
  );
}
