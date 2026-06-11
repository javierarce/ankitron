import { useEffect, useState } from "react";
import { CircleHalf } from "@phosphor-icons/react/dist/ssr/CircleHalf";
import { Moon } from "@phosphor-icons/react/dist/ssr/Moon";
import { Sun } from "@phosphor-icons/react/dist/ssr/Sun";

type Theme = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function ThemeToggle() {
  // index.html applies the saved theme before React loads, so reading
  // localStorage during the initial render can't cause a flash.
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme | null) ?? "system"
  );

  // Sync the DOM with the selected theme, and while following the system
  // theme, track OS-level changes.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, [theme]);

  function cycle() {
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    localStorage.setItem("theme", next);
  }

  return (
    <button
      onClick={cycle}
      title={`Theme: ${theme}`}
      aria-label={`Theme: ${theme}`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <ThemeIcon theme={theme} />
    </button>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") return <Sun size={16} weight="regular" />;
  if (theme === "dark") return <Moon size={16} weight="regular" />;
  return <CircleHalf size={16} weight="regular" />;
}
