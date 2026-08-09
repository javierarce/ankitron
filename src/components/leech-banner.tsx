// The deck page's leech notice: the notes Anki has flagged as leeches, with a
// way into them. Anki only mentions a leech once, in a reviewer tooltip you're
// likely to press past — this is the standing version of that.
//
// No dismiss on purpose: it's a to-do list, and clearing the `leech` tag off a
// note you've dealt with is what empties it (see lib/leeches.ts). It stands
// down once the list is filtered to the leeches — by then the selection it made
// has handed the job to the bulk action bar.
//
// It's a notice, not an alert: amber shows in the icon and the border, while the
// text stays in the normal foreground colours (amber body text is too low
// contrast to read comfortably in both themes).

import { Warning } from "@phosphor-icons/react/dist/ssr/Warning";
import { leechSummary, type LeechCount } from "@/lib/leeches";

interface LeechBannerProps {
  count: LeechCount;
  /** Filter the list to the leeches and select them. */
  onShow: () => void;
}

export function LeechBanner({ count, onShow }: LeechBannerProps) {
  const { title, detail } = leechSummary(count);
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5"
    >
      <Warning
        size={18}
        weight="fill"
        aria-hidden="true"
        className="shrink-0 text-amber-600 dark:text-amber-500"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-foreground/60">{detail}</p>
      </div>
      {/* One action, and it hands off rather than acting: the selection it
          leaves behind puts every verb — Edit (the one-at-a-time walkthrough
          the references recommend), Forget, Suspend, Tag, Delete — in the bulk
          bar, which can do far more than this banner ever should. */}
      <button
        type="button"
        onClick={onShow}
        className="shrink-0 whitespace-nowrap rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-sm text-amber-700 transition-colors hover:bg-amber-500/10 focus:outline-none focus:border-amber-500 dark:text-amber-400"
      >
        Show leeches
      </button>
    </div>
  );
}
