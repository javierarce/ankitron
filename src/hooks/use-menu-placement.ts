import { CSSProperties, RefObject, useLayoutEffect, useState } from "react";

export interface MenuPlacementOptions {
  /** Which edge of the button the menu's matching edge lines up with. */
  align?: "left" | "right";
  /** Gap in px between the button and the menu. */
  gap?: number;
  /** Minimum gap in px to keep between the menu and the viewport edges. */
  margin?: number;
}

export interface MenuPlacement {
  /** True once a real position has been measured (false for the first paint). */
  ready: boolean;
  /** Fixed-position style to spread onto the (portalled) menu element. */
  style: CSSProperties;
}

// Hidden off-screen style used before we've measured the menu. useLayoutEffect
// runs before the browser paints, so the menu is placed for real without a
// visible flash — but it must render first so we can measure its size.
const HIDDEN: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  visibility: "hidden",
};

/**
 * Computes flip-aware fixed coordinates for a dropdown menu rendered in a
 * portal (so it escapes any overflow-hidden ancestor). The menu prefers to
 * open below its button, but flips above when it doesn't fit below and there's
 * more room up top — and caps its height to the available space either way, so
 * a menu near the bottom of the viewport is never clipped. Reposition happens
 * on scroll/resize so the menu stays glued to a moving button.
 *
 * The menu should carry `overflow-y-auto` so the height cap can scroll when
 * even the roomier side is too short.
 */
export function useMenuPlacement(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  { align = "right", gap = 4, margin = 8 }: MenuPlacementOptions = {},
): MenuPlacement {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    function place() {
      const a = anchor!.getBoundingClientRect();
      const m = menu!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Full content height, unaffected by any height cap we set last pass, so
      // the flip decision doesn't oscillate once the menu starts scrolling.
      const menuHeight = menu!.scrollHeight;

      const spaceBelow = vh - a.bottom - gap - margin;
      const spaceAbove = a.top - gap - margin;

      const next: CSSProperties = { position: "fixed" };

      // Vertical: open below by default; flip above only when it won't fit
      // below and above has more room.
      if (menuHeight <= spaceBelow || spaceBelow >= spaceAbove) {
        next.top = a.bottom + gap;
        next.maxHeight = Math.max(0, spaceBelow);
      } else {
        next.bottom = vh - a.top + gap;
        next.maxHeight = Math.max(0, spaceAbove);
      }

      // Horizontal: line the menu up with the requested button edge, then nudge
      // it back on-screen if that would push it past a viewport edge.
      if (align === "right") {
        let right = vw - a.right;
        if (vw - right - m.width < margin) {
          right = Math.max(margin, vw - m.width - margin);
        }
        next.right = right;
      } else {
        let left = a.left;
        if (left + m.width > vw - margin) {
          left = Math.max(margin, vw - m.width - margin);
        }
        next.left = left;
      }

      setStyle(next);
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, menuRef, align, gap, margin]);

  return { ready: style !== null, style: style ?? HIDDEN };
}
