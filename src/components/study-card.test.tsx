// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// audio.ts pulls in ankiFetch; the card here has no media, so a no-op stub is
// enough to let the module import cleanly under jsdom.
vi.mock("@/lib/anki-fetch", () => ({
  ankiFetch: vi.fn(async () => undefined),
}));

import { StudyCard } from "./study-card";

// A typed-cloze card: the `[[type:cloze:…]]` marker makes StudyCard render the
// text input the user answers into.
const QUESTION = "Capital of France: [[type:cloze:1]]";
const ANSWER = "Capital of France: Paris";

// Mirrors how StudyPage drives the card: `isRevealed` flips true when the typed
// answer is submitted (onReveal) and back to false when a card is (re)served.
function Harness() {
  const [revealed, setRevealed] = useState(false);
  return (
    <div>
      <button onClick={() => setRevealed(false)}>reserve</button>
      <StudyCard
        question={QUESTION}
        answer={ANSWER}
        isRevealed={revealed}
        onReveal={() => setRevealed(true)}
        onAnswer={() => {}}
        onEdit={() => {}}
        onSuspend={() => {}}
        answering={false}
        sounds={[]}
      />
    </div>
  );
}

afterEach(cleanup);

describe("StudyCard typed answer", () => {
  it("clears the typed input when the same card is served again", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = () =>
      screen.getByPlaceholderText("Type your answer…") as HTMLInputElement;

    await user.type(input(), "hola");
    expect(input().value).toBe("hola");

    // Submit — reveals the answer side, so the input is gone.
    await user.keyboard("{Enter}");
    expect(screen.queryByPlaceholderText("Type your answer…")).toBeNull();

    // Anki re-serves the identical card (e.g. after a Fail): same question,
    // reveal flag drops back to false. The input must come back empty.
    await user.click(screen.getByText("reserve"));
    expect(input().value).toBe("");
  });
});
