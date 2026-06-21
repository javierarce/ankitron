import { ArrowCircleUp } from "@phosphor-icons/react/dist/ssr/ArrowCircleUp";
import { useUpdate } from "@/components/update-context";

/**
 * A Chrome-style pill in the header: shows up only when an update is waiting,
 * and tapping it opens the install dialog. Quietly signals the update instead
 * of interrupting with a modal on launch.
 */
export function UpdateBadge() {
  const { update, openDialog } = useUpdate();

  if (!update) return null;

  const label = `New version available: Ankitron ${update.version}`;

  return (
    <button
      onClick={openDialog}
      title={label}
      aria-label={label}
      className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-500/20 dark:text-blue-400"
    >
      <ArrowCircleUp size={15} weight="fill" />
      New version available
    </button>
  );
}
