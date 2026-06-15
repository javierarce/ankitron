import { useEffect } from "react";

// The whole page scrolls on <body> (see index.html / layout.tsx — there is no
// inner scroll container), so a dialog's backdrop otherwise lets the wheel
// scroll the content showing through it. Lock body scroll while any dialog is
// open. Ref-counted so stacked dialogs (e.g. a confirm over a form) don't
// unlock the page when only the inner one closes.
let lockCount = 0;
let prevOverflow = "";

/**
 * Locks `document.body` scroll while `active` is true. Pass the dialog's open
 * state; mounted-only-when-open dialogs can call it with no argument.
 */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount++;
    return () => {
      lockCount--;
      if (lockCount === 0) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [active]);
}
