// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { ToastProvider } from "./toast-provider";
import { useToast } from "@/lib/toast-context";

// A consumer that fires an error toast on demand, standing in for a failed
// mutation handler.
function Trigger({ message }: { message: string }) {
  const toast = useToast();
  return <button onClick={() => toast.error(message)}>trigger {message}</button>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("shows the error and auto-dismisses it after 5 seconds", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger message="Couldn't delete the note." />
      </ToastProvider>,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByText("trigger Couldn't delete the note."));

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't delete the note.",
    );

    // Still up just before the deadline…
    act(() => vi.advanceTimersByTime(4999));
    expect(screen.queryByRole("alert")).not.toBeNull();

    // …gone once it passes.
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("dismisses on click", () => {
    render(
      <ToastProvider>
        <Trigger message="boom" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("trigger boom"));
    // The toast pill itself is the dismiss button; its accessible name is the
    // message it shows.
    fireEvent.click(screen.getByRole("button", { name: "boom" }));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces the current toast instead of stacking", () => {
    render(
      <ToastProvider>
        <Trigger message="first" />
        <Trigger message="second" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("trigger first"));
    fireEvent.click(screen.getByText("trigger second"));

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain("second");
  });
});
