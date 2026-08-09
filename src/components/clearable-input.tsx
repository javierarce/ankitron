import { forwardRef, useImperativeHandle, useRef } from "react";
import { X } from "@phosphor-icons/react/dist/ssr/X";

interface ClearButtonProps {
  onClear: () => void;
  /** Accessible name; worth overriding when a view has several fields. */
  label?: string;
  className?: string;
}

/**
 * The small grey x that empties a text field. Positions itself against the
 * nearest positioned ancestor, so its container needs `relative` and the field
 * needs enough right padding to keep text from running underneath (ClearableInput
 * handles both). Use this directly only for composite fields whose markup can't
 * go through ClearableInput — the search box's coloured backdrop, say.
 *
 * Not in the tab order, matching the native search-field cancel button: it's a
 * pointer shortcut for something the keyboard already does (select-all + delete,
 * or Escape where the field supports it), and a stop between every field and the
 * next would be noise.
 */
export function ClearButton({ onClear, label = "Clear", className }: ClearButtonProps) {
  return (
    <button
      type="button"
      // Several fields commit or cancel on blur (the tag box, the inline deck
      // rename), so pressing the x must not pull focus out of the input.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
      tabIndex={-1}
      aria-label={label}
      className={`absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-foreground/30 transition-colors hover:text-foreground/60 ${className ?? ""}`}
    >
      <X size={12} weight="bold" />
    </button>
  );
}

interface ClearableInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value"> {
  value: string;
  onClear: () => void;
  /** Accessible name for the x; defaults to "Clear". */
  clearLabel?: string;
  /**
   * Classes for the wrapper the input now sits in. Layout that used to live on
   * the input — margins, flex sizing — belongs here; the input keeps `w-full`.
   */
  wrapperClassName?: string;
}

/**
 * A text input with a clear button that appears once there's something to clear.
 * A drop-in for a plain <input>: pass the same props plus `onClear`, and move any
 * margin/flex classes to `wrapperClassName`.
 */
export const ClearableInput = forwardRef<HTMLInputElement, ClearableInputProps>(
  function ClearableInput(
    { value, onClear, clearLabel, wrapperClassName, className, ...rest },
    ref,
  ) {
    const innerRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => innerRef.current!, []);

    const showClear = value.length > 0 && !rest.disabled && !rest.readOnly;

    return (
      <div className={`relative ${wrapperClassName ?? ""}`}>
        <input
          {...rest}
          ref={innerRef}
          value={value}
          // pr-7 reserves the button's lane; Tailwind emits padding-right after
          // padding-inline, so it wins over any px-* the caller passes.
          className={`${className ?? ""} pr-7`}
        />
        {showClear && (
          <ClearButton
            label={clearLabel}
            onClear={() => {
              onClear();
              innerRef.current?.focus();
            }}
          />
        )}
      </div>
    );
  },
);
