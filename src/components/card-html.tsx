import { useEffect, useRef } from "react";
import { getMediaUrl, MEDIA_ATTR, prepareCardHtml } from "@/lib/audio";

/** Renders HTML imperatively via a ref so React never re-creates the
 * inner DOM on re-renders (which would destroy any selected text node
 * inside). Card media (<img>) references bare collection-media filenames the
 * app origin can't serve, so prepareCardHtml strips those srcs (no broken-image
 * flash) and we pull each file from Anki and fade it in. */
export function HtmlContent({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const renderedHtml = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only rewrite innerHTML when the html actually changes (avoids clobbering
    // selection); image resolution runs every invocation so StrictMode's
    // double-mount can't leave images stuck transparent. `cancelled` guards
    // against the html changing before a fetch resolves.
    if (renderedHtml.current !== html) {
      renderedHtml.current = html;
      el.innerHTML = prepareCardHtml(html);
    }
    let cancelled = false;
    el.querySelectorAll<HTMLImageElement>(`img[${MEDIA_ATTR}]`).forEach((img) => {
      const filename = img.getAttribute(MEDIA_ATTR) ?? "";
      getMediaUrl(filename).then((url) => {
        if (cancelled) return;
        if (url) {
          img.onload = () => {
            img.style.opacity = "1";
          };
          img.src = url;
        } else {
          // Missing/unreachable: reveal anyway so any alt text shows.
          img.style.opacity = "1";
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [html]);
  return <div ref={ref} className={className} />;
}
