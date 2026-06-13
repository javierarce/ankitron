import { createContext, useContext } from "react";
import type { Update } from "@tauri-apps/plugin-updater";

export type UpdateContextValue = {
  /** The pending update, or null when up to date / still checking. */
  update: Update | null;
  /** Whether the install dialog is currently shown. */
  isDialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  /** Record a freshly found update (e.g. from a manual check) and open the
   *  install dialog. */
  presentUpdate: (found: Update) => void;
};

export const UpdateContext = createContext<UpdateContextValue | null>(null);

export function useUpdate() {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error("useUpdate must be used within an UpdateProvider");
  }
  return ctx;
}
