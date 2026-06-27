import { useState, type ReactNode } from "react";

type TooltipSide = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  /** What the tooltip shows. */
  content: ReactNode;
  /** The element that triggers the tooltip on hover/focus. */
  children: ReactNode;
  /** Which side of the trigger the tooltip floats on. Defaults to "top". */
  side?: TooltipSide;
  /** Extra classes for the floating tooltip (e.g. to override its width). */
  className?: string;
}

// Anchors the tooltip to the chosen side of the trigger and centers it along
// the perpendicular axis.
const sideClasses: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

/**
 * A lightweight, reusable tooltip. Wrap any element to show floating content on
 * hover or keyboard focus — not the native `title` tooltip, so it's styled and
 * supports rich content. Purely CSS-positioned relative to the trigger.
 */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground/70 shadow-md transition-opacity duration-150 ease-out ${sideClasses[side]} ${open ? "opacity-100" : "opacity-0"} ${className ?? ""}`}
      >
        {content}
      </span>
    </span>
  );
}
