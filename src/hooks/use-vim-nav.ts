import { useEffect } from "react";

interface UseVimNavOptions {
  enabled?: boolean;
  /** `l` / `→` on the focused item — e.g. expand a deck in a tree. */
  onExpand?: (focused: HTMLElement) => void;
  /** `h` / `←` on the focused item — e.g. collapse a deck or move to its parent. */
  onCollapse?: (focused: HTMLElement) => void;
}

export function useVimNav({
  enabled = true,
  onExpand,
  onCollapse,
}: UseVimNavOptions = {}) {
  useEffect(() => {
    if (!enabled) return;

    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    function clearGPending() {
      gPending = false;
      if (gTimer) {
        clearTimeout(gTimer);
        gTimer = null;
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const items = Array.from(
        document.querySelectorAll<HTMLElement>("[data-nav-item]")
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        clearGPending();
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? items.indexOf(active) : -1;

      const focus = (i: number) => {
        const el = items[i];
        el.focus();
        el.scrollIntoView({ block: "nearest" });
      };

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        clearGPending();
        focus(currentIndex < 0 ? 0 : Math.min(currentIndex + 1, items.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        clearGPending();
        focus(currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0));
      } else if (e.key === "G") {
        e.preventDefault();
        clearGPending();
        focus(items.length - 1);
      } else if (e.key === "g") {
        e.preventDefault();
        if (gPending) {
          clearGPending();
          focus(0);
        } else {
          gPending = true;
          gTimer = setTimeout(clearGPending, 500);
        }
      } else if (e.key === "l" || e.key === "ArrowRight") {
        if (onExpand && active && currentIndex >= 0) {
          e.preventDefault();
          clearGPending();
          onExpand(active);
        } else {
          clearGPending();
        }
      } else if (e.key === "h" || e.key === "ArrowLeft") {
        // h/← collapses the focused row in a tree (via onCollapse). It never
        // navigates — these are list keys only, not a "go back" shortcut.
        if (onCollapse && active && currentIndex >= 0) {
          e.preventDefault();
          clearGPending();
          onCollapse(active);
        } else {
          clearGPending();
        }
      } else {
        clearGPending();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearGPending();
    };
  }, [enabled, onExpand, onCollapse]);
}
