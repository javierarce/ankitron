import { createContext, useContext } from "react";

export interface ToastContextValue {
  /**
   * Show a transient error toast. Deliberately the whole API: it exists for
   * mutations whose UI has already moved on (a failed delete, drag-move,
   * suspend…), where there's no dialog left to show the failure inline.
   */
  error: (message: string) => void;
}

export const ToastContext = createContext<ToastContextValue>({
  error: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}
