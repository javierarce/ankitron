// The custom drag preview for dragging note rows: a solid count badge that
// replaces the browser's default semi-transparent row snapshot.

/**
 * Build the badge element. The element must live in the DOM when the browser
 * snapshots it, so the caller appends it to <body> (off-screen) and tears it
 * down on drag end. A transparent-padded wrapper lets the caller put the
 * cursor hotspot at its top-left (0, 0) so the pill trails just below-right of
 * the pointer instead of sitting under it.
 */
export function createDragBadge(count: number): HTMLElement {
  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "fixed",
    top: "-9999px",
    left: "-9999px",
    // Top/left set the cursor-to-pill gap; right/bottom just leave room so the
    // pill's drop shadow isn't clipped out of the snapshot.
    paddingTop: "14px",
    paddingLeft: "16px",
    paddingRight: "20px",
    paddingBottom: "26px",
    pointerEvents: "none",
  });
  const badge = document.createElement("div");
  badge.textContent = count === 1 ? "1 note" : `${count} notes`;
  Object.assign(badge.style, {
    padding: "0.375rem 0.75rem",
    borderRadius: "9999px",
    fontSize: "0.875rem",
    fontWeight: "600",
    whiteSpace: "nowrap",
    background: "var(--foreground)",
    color: "var(--background)",
    boxShadow: "0 6px 16px rgba(0, 0, 0, 0.25)",
  });
  wrapper.appendChild(badge);
  return wrapper;
}
