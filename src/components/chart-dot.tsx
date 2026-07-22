import type { ReactNode } from "react";
import { Tooltip } from "./tooltip";

const DOT_SIZE = { sm: "h-2 w-2", md: "h-2.5 w-2.5", lg: "h-3 w-3" } as const;

interface ChartDotProps {
  /** Position in the chart's 0–100 coordinate space (as the stretched SVG uses). */
  x: number;
  y: number;
  /** Fill colour — a grade colour, an accent, or a neutral. */
  color: string;
  /** What the dot's tooltip shows on hover. */
  content: ReactNode;
  size?: keyof typeof DOT_SIZE;
}

/**
 * A positioned, tooltip-labelled dot shared by the inline SVG charts (the note
 * stats' interval history and the session summary's accuracy sparkline). It
 * centres itself on (x, y) over the stretched chart, grows a 20px hit target
 * around the visible dot, and — the reason this is one component rather than
 * copy-pasted markup — opens its tooltip inward near the left/right edges so a
 * scrolling dialog can't clip it. Change that behaviour here, once.
 */
export function ChartDot({ x, y, color, content, size = "md" }: ChartDotProps) {
  const side = x < 20 ? "top-start" : x > 80 ? "top-end" : "top";
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <Tooltip side={side} content={content}>
        <span className="group flex h-5 w-5 items-center justify-center">
          <span
            className={`block rounded-full ring-2 ring-background transition-transform group-hover:scale-125 ${DOT_SIZE[size]}`}
            style={{ backgroundColor: color }}
          />
        </span>
      </Tooltip>
    </div>
  );
}
