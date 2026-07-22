// The four answer buttons, in Anki's order, with the colours the stats charts,
// the distribution bars, and the end-of-session summary all share. Again reads
// as a failure, the rest as a pass.
export const GRADES = [
  { ease: 1, label: "Again", color: "#ef4444" },
  { ease: 2, label: "Hard", color: "#f59e0b" },
  { ease: 3, label: "Good", color: "#22c55e" },
  { ease: 4, label: "Easy", color: "#3b82f6" },
] as const;

/** The colour for an answer button, or a neutral grey for a non-answer row. */
export const gradeColor = (ease: number) =>
  GRADES.find((g) => g.ease === ease)?.color ?? "#a1a1aa";
