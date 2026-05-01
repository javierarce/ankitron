"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface UseVimNavOptions {
  back?: string;
  enabled?: boolean;
}

export function useVimNav({ back, enabled = true }: UseVimNavOptions = {}) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    function clearGPending() {
      gPending = false;
      if (gTimer) {
        clearTimeout(gTimer);
        gTimer = null;
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const items = Array.from(
        document.querySelectorAll<HTMLElement>("[data-nav-item]")
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        clearGPending();
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? items.indexOf(active) : -1;

      const focus = (i: number) => {
        const el = items[i];
        el.focus();
        el.scrollIntoView({ block: "nearest" });
      };

      if (e.key === "j") {
        e.preventDefault();
        clearGPending();
        focus(currentIndex < 0 ? 0 : Math.min(currentIndex + 1, items.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        clearGPending();
        focus(currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0));
      } else if (e.key === "G") {
        e.preventDefault();
        clearGPending();
        focus(items.length - 1);
      } else if (e.key === "g") {
        e.preventDefault();
        if (gPending) {
          clearGPending();
          focus(0);
        } else {
          gPending = true;
          gTimer = setTimeout(clearGPending, 500);
        }
      } else if (e.key === "h" && back !== undefined) {
        e.preventDefault();
        clearGPending();
        router.push(back);
      } else {
        clearGPending();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearGPending();
    };
  }, [router, back, enabled]);
}
