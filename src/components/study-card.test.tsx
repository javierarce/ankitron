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

describe("StudyCard new-card badge", () => {
  const props = {
    question: "What is the capital of France?",
    answer: "Paris",
    onReveal: () => {},
    onAnswer: () => {},
    onEdit: () => {},
    onSuspend: () => {},
    answering: false,
    sounds: [],
  };

  it("shows a 'new card' badge only when the card is new", () => {
    const { rerender } = render(
      <StudyCard {...props} isRevealed={false} isNew />,
    );
    expect(screen.getByText("new card")).toBeTruthy();

    rerender(<StudyCard {...props} isRevealed={false} isNew={false} />);
    expect(screen.queryByText("new card")).toBeNull();
  });

  it("keeps the badge shown after the card is revealed", () => {
    render(<StudyCard {...props} isRevealed isNew />);
    expect(screen.getByText("new card")).toBeTruthy();
  });

  it("uses the default cream/gold chip when the card is unflagged", () => {
    render(<StudyCard {...props} isRevealed={false} isNew flag={0} />);
    // The chip is the label's parent; its inline style carries the colours.
    const chip = screen.getByText("new card").parentElement as HTMLElement;
    expect(chip.style.borderColor).toBe("rgb(255, 204, 0)"); // #FFCC00
    expect(chip.style.color).toBe("rgb(23, 23, 23)"); // #171717
  });

  it("recolours the badge to the flag when the card is flagged", () => {
    render(<StudyCard {...props} isRevealed={false} isNew flag={1} />);
    const chip = screen.getByText("new card").parentElement as HTMLElement;
    // Flag 1's colour is the themeable --flag-1 token, not the cream/gold default.
    expect(chip.style.borderColor).toBe("var(--flag-1)");
    expect(chip.style.color).toBe("var(--flag-1)");
  });
});
