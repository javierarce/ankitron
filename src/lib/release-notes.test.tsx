// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReleaseNotes } from "./release-notes";

afterEach(cleanup);

describe("ReleaseNotes", () => {
  it("renders bullets as a list with bold and inline code", () => {
    const { container } = render(
      <ReleaseNotes
        text={"- **Card flags** — filter with `flag:` search\n- Second item"}
      />,
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("Card flags");
    expect(container.querySelector("code")?.textContent).toBe("flag:");
    // The delimiters themselves are gone, not shown literally.
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("`");
  });

  it("renders non-bullet lines as paragraphs and skips blanks", () => {
    const { container } = render(
      <ReleaseNotes text={"A plain line.\n\nAnother one."} />,
    );
    const paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(2);
    expect(container.querySelectorAll("ul")).toHaveLength(0);
    expect(screen.getByText("A plain line.")).toBeTruthy();
  });

  it("shows unmatched markup verbatim rather than dropping it", () => {
    const { container } = render(<ReleaseNotes text={"a * b _c_ d"} />);
    expect(container.textContent).toContain("a * b _c_ d");
  });
});
