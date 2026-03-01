"use client";

import { useEffect, useState } from "react";

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
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    const initial = saved ?? "system";
    setTheme(initial);
    applyTheme(initial);
    setMounted(true);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      const current = localStorage.getItem("theme") as Theme | null;
      if (!current || current === "system") {
        applyTheme("system");
      }
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  function cycle() {
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  if (!mounted) return <div className="w-7 h-7" />;

  const icons: Record<Theme, string> = {
    light: "☀",
    dark: "☾",
    system: "◐",
  };

  return (
    <button
      onClick={cycle}
      title={`Theme: ${theme}`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-sm text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      {icons[theme]}
    </button>
  );
}
