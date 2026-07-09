// A minimal Markdown renderer for the updater's release notes. The notes come
// from the GitHub release (via latest.json) and use only a small subset —
// bullet lists, **bold**, and `inline code` — so we render that subset to real
// React nodes rather than pulling a full Markdown dependency into the app for
// one dialog. Rendering to nodes (never dangerouslySetInnerHTML) also means the
// text can't inject markup. Anything we don't recognise is shown verbatim.

import { type ReactNode } from "react";

// Split a line into **bold** / `code` / plain runs.
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*.+?\*\*|`.+?`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <code
          key={`${keyPrefix}-${i}`}
          className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Render release-note text: consecutive `- `/`* ` lines become a bulleted list,
 * every other non-blank line a paragraph, with inline bold and code parsed
 * within each. Blank lines just separate blocks.
 */
export function ReleaseNotes({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = (key: string) => {
    if (items.length === 0) return;
    const current = items;
    items = [];
    blocks.push(
      <ul key={key} className="list-disc space-y-1 pl-4">
        {current.map((it, i) => (
          <li key={i}>{inline(it, `${key}-${i}`)}</li>
        ))}
      </ul>,
    );
  };

  text.split("\n").forEach((line, idx) => {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      items.push(bullet[1]);
    } else {
      flush(`ul-${idx}`);
      if (line.trim()) {
        blocks.push(<p key={`p-${idx}`}>{inline(line, `p-${idx}`)}</p>);
      }
    }
  });
  flush("ul-end");

  return <>{blocks}</>;
}
