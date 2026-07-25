/** `<input>` types that hold no text. Backspace in one of these can never be a
 *  deletion, so WebKit treats it as history navigation — exactly what we block. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** True when Backspace on this target is a real deletion (a text field or the
 *  rich-text editor) rather than WebKit's back/forward shortcut. Note that
 *  `input.type` normalizes anything unrecognized to "text", so a future input
 *  type errs toward keeping Backspace working. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName === "INPUT") {
    return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  }
  return false;
}
