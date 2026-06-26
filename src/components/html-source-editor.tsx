import { highlightHtml } from "@/lib/html-source";

interface HtmlSourceEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

// Layout-affecting styles shared verbatim by the highlighted layer and the
// editable textarea. They must match exactly (font, size, line height, padding,
// wrapping) so the caret in the transparent textarea lines up with the colored
// text rendered behind it.
const SHARED =
  "m-0 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words";

// A syntax-highlighted, editable raw-HTML view: a transparent <textarea> on top
// of a <pre> that renders the colorized HTML. The textarea drives editing and
// the caret; the pre underneath provides the color.
//
// The outer div is the scroll container with a *fixed* default height (100px,
// matching the rich editor's common height) rather than one that grows with
// content — so switching to HTML doesn't balloon the box. It stays manually
// resizable (resize-y) up to 400px, and taller HTML scrolls inside it. The
// inner wrapper is at least as tall as the box (min-h-full) so the textarea,
// which is absolutely sized to it, always fills the visible area and stays
// clickable; when the HTML is taller it grows past that and the outer div
// scrolls, moving pre and textarea together — no JS scroll sync needed.
export function HtmlSourceEditor({ value, onChange, placeholder }: HtmlSourceEditorProps) {
  return (
    <div className="h-[100px] min-h-[100px] max-h-[400px] resize-y overflow-auto">
      <div className="relative min-h-full">
        <pre
          aria-hidden
          className={`${SHARED} text-foreground/80`}
          // Trailing newline keeps the last line's height so the textarea's
          // final row stays aligned while typing at the end.
          dangerouslySetInnerHTML={{ __html: highlightHtml(value) + "\n" }}
        />
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={`${SHARED} absolute inset-0 block w-full resize-none overflow-hidden border-0 bg-transparent text-transparent caret-foreground outline-none placeholder:text-foreground/30`}
        />
      </div>
    </div>
  );
}
