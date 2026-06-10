/**
 * Whether the study undo (z) action is allowed. Undo only steps back through
 * reviews made in the current deck's session, so it's blocked once the session
 * is complete (no card to return to — it would silently revert a review
 * off-screen) and before anything has been reviewed.
 */
export function canUndo(state: {
  completed: boolean;
  reviewed: number;
}): boolean {
  return !state.completed && state.reviewed > 0;
}
