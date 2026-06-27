import { useRef, useState, type ReactNode } from "react";
import { isScrollLocked, useScrollLock } from "@/hooks/use-scroll-lock";

interface FileDropZoneProps {
  /** Called with the first dropped file. */
  onFile: (file: File) => void;
  /** Headline shown in the drop overlay. */
  label?: string;
  /** Forwarded to the wrapping element so it can keep the page's layout. */
  className?: string;
  children: ReactNode;
}

// We only take over drags that carry external files; internal drags (e.g. the
// card-list segment chips) set custom data types instead and must pass through
// untouched — never preventing their default would break those drops.
function hasFiles(e: React.DragEvent) {
  return Array.from(e.dataTransfer.types).includes("Files");
}

/**
 * Wraps a page region so dropping a file onto it calls `onFile`, showing a
 * full-screen overlay while a file is dragged over. The overlay is
 * `pointer-events-none` so the drop still lands on this element's handlers.
 */
export function FileDropZone({
  onFile,
  label = "Drop a deck JSON file to import",
  className,
  children,
}: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  // Lock body scroll while the overlay is up, exactly as dialogs do. This drops
  // the scrollbar so the centered label lands in the same place regardless of
  // whether the page underneath was tall enough to scroll; the dark scrim hides
  // the brief reflow.
  useScrollLock(dragging);
  // dragenter/dragleave fire for every child boundary the pointer crosses;
  // count the nesting so the overlay only clears once the pointer truly leaves.
  const depth = useRef(0);

  function reset() {
    depth.current = 0;
    setDragging(false);
  }

  // Ignore drags while another overlay already owns the page (a dialog, the
  // command palette, a card editor). Those hold the scroll lock; our own
  // overlay's lock only exists once `dragging` is true, so it doesn't count —
  // this keeps a file from being imported on top of an open dialog.
  function blockedByOtherOverlay() {
    return !dragging && isScrollLocked();
  }

  return (
    <div
      className={className}
      onDragEnter={(e) => {
        if (!hasFiles(e) || blockedByOtherOverlay()) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e) || blockedByOtherOverlay()) return;
        // Required for the element to be a valid drop target.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e) || blockedByOtherOverlay()) return;
        depth.current -= 1;
        if (depth.current <= 0) reset();
      }}
      onDrop={(e) => {
        if (!hasFiles(e) || blockedByOtherOverlay()) return;
        reset();
        // A deeper handler may have already claimed this drop — e.g. the card
        // editor inserting a dropped audio file. It calls preventDefault, so
        // skip the import rather than fighting it for the same file.
        if (e.defaultPrevented) return;
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <p className="text-lg font-semibold text-white">{label}</p>
        </div>
      )}
    </div>
  );
}
