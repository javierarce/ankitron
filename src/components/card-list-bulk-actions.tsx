// The bulk-action toolbar's button cluster with a priority+ overflow menu.
// Edit, Suspend, Tag, Flag, Move render left-to-right and collapse into a "⋯"
// menu from the right (Move first, Edit last) whenever the row runs out of
// width; Delete always stays visible. Button widths are measured from a hidden
// mirror row, so the cutoff is exact and never oscillates — the flex-1
// container's width is fixed by the layout, not by how many buttons show, so
// hiding one never changes the space available to the rest.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Pause } from "@phosphor-icons/react/dist/ssr/Pause";
import { Play } from "@phosphor-icons/react/dist/ssr/Play";
import { Tag } from "@phosphor-icons/react/dist/ssr/Tag";
import { Flag } from "@phosphor-icons/react/dist/ssr/Flag";
import { FolderSimple } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { DotsThree } from "@phosphor-icons/react/dist/ssr/DotsThree";
import { ActionsMenu, Kbd, type ActionsMenuItem } from "./actions-menu";
import { FlagPicker } from "./flag-picker";
import { FLAGS } from "@/lib/flags";

const BTN =
  "flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors";
const DOTS =
  "flex shrink-0 items-center rounded-lg border border-border px-2.5 py-1.5 text-sm";

interface BulkActionBarProps {
  allSelectedSuspended: boolean;
  onEditSelection: () => void;
  onBulkSuspend: (suspend: boolean) => void;
  onBulkFlag: (flag: number) => void;
  onBulkMove: () => void;
  onBulkTag: () => void;
  onBulkDelete: () => void;
}

interface CollapsibleAction {
  key: string;
  /** The full labelled control shown while the action fits on the row. */
  button: ReactNode;
  /** Its representation once it collapses into the overflow menu. */
  menuItems: ActionsMenuItem[];
}

function flagDot(color?: string) {
  return color ? (
    <span className="h-3 w-3 rounded-full" style={{ background: color }} />
  ) : (
    <span className="h-3 w-3 rounded-full border border-foreground/30" />
  );
}

export function BulkActionBar({
  allSelectedSuspended,
  onEditSelection,
  onBulkSuspend,
  onBulkFlag,
  onBulkMove,
  onBulkTag,
  onBulkDelete,
}: BulkActionBarProps) {
  // The flag picker is a colour grid both as its own dropdown and inside the
  // overflow menu, so build the item list once and reuse it in both places.
  const flagMenuItems: ActionsMenuItem[] = [
    {
      render: () => (
        <div className="px-3 pb-0.5 pt-1 text-xs text-foreground/40">Flag</div>
      ),
    },
    ...FLAGS.map((f) => ({
      label: (
        <span className="flex items-center gap-2">
          {flagDot(f.color)}
          {f.name}
        </span>
      ),
      onSelect: () => onBulkFlag(f.value),
    })),
    {
      label: (
        <span className="flex items-center gap-2">
          {flagDot()}
          No flag
        </span>
      ),
      onSelect: () => onBulkFlag(0),
    },
  ];

  // Order matters: it's both the on-screen left-to-right order and the collapse
  // priority — the last entry (Move) is the first to fold into the "⋯" menu.
  const actions: CollapsibleAction[] = [
    {
      key: "edit",
      button: (
        <button key="edit" onClick={onEditSelection} className={BTN}>
          <PencilSimple size={16} weight="bold" />
          Edit
          <Kbd>E</Kbd>
        </button>
      ),
      menuItems: [{ label: "Edit", kbd: "E", onSelect: onEditSelection }],
    },
    {
      key: "suspend",
      button: (
        <button
          key="suspend"
          onClick={() => onBulkSuspend(!allSelectedSuspended)}
          className={BTN}
        >
          {allSelectedSuspended ? (
            <>
              <Play size={16} weight="bold" />
              Unsuspend
            </>
          ) : (
            <>
              <Pause size={16} weight="bold" />
              Suspend
            </>
          )}
          <Kbd>S</Kbd>
        </button>
      ),
      menuItems: [
        {
          label: allSelectedSuspended ? "Unsuspend" : "Suspend",
          kbd: "S",
          onSelect: () => onBulkSuspend(!allSelectedSuspended),
        },
      ],
    },
    {
      key: "tag",
      button: (
        <button key="tag" onClick={onBulkTag} className={BTN}>
          <Tag size={16} weight="bold" />
          Tag
          <Kbd>T</Kbd>
        </button>
      ),
      menuItems: [{ label: "Tag", kbd: "T", onSelect: onBulkTag }],
    },
    {
      key: "flag",
      button: (
        <ActionsMenu
          key="flag"
          label="Flag selected notes"
          triggerContent={
            <>
              <Flag size={16} weight="bold" />
              Flag
            </>
          }
          triggerClassName={(open) => `${BTN} ${open ? "bg-foreground/5" : ""}`}
          menuClassName="min-w-[150px]"
          items={flagMenuItems}
        />
      ),
      // Flag is handled specially in the overflow menu (rendered as the colour
      // grid at the bottom), so it contributes no plain items of its own.
      menuItems: [],
    },
    {
      key: "move",
      button: (
        <button key="move" onClick={onBulkMove} className={BTN}>
          <FolderSimple size={16} weight="bold" />
          Move
          <Kbd>M</Kbd>
        </button>
      ),
      menuItems: [{ label: "Move", kbd: "M", onSelect: onBulkMove }],
    },
  ];

  const containerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(actions.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const mirror = mirrorRef.current;
    if (!container || !mirror) return;
    const nodes = Array.from(mirror.children) as HTMLElement[];
    const dotsWidth = nodes[nodes.length - 1].offsetWidth;
    const widths = nodes.slice(0, actions.length).map((n) => n.offsetWidth);
    const GAP = 8; // gap-2 between buttons
    const recompute = () => {
      const avail = container.clientWidth;
      // Unmeasurable (hidden, or no layout as in jsdom): show everything rather
      // than collapse it all into the menu.
      if (avail <= 0) {
        setVisibleCount((prev) => (prev === actions.length ? prev : actions.length));
        return;
      }
      const totalAll =
        widths.reduce((a, b) => a + b, 0) + GAP * (widths.length - 1);
      let count = actions.length;
      if (totalAll > avail) {
        // Reserve the "⋯" trigger, then keep the highest-priority buttons that
        // still fit; the rest collapse into the menu.
        let used = dotsWidth;
        count = 0;
        for (const w of widths) {
          const next = used + GAP + w;
          if (next > avail) break;
          used = next;
          count++;
        }
      }
      setVisibleCount((prev) => (prev === count ? prev : count));
    };
    recompute();
    // ResizeObserver is absent in jsdom; the one-shot measure above still runs.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
    // actions.length is constant; the Suspend label's width is the only content
    // that changes, so re-measure when it flips.
  }, [actions.length, allSelectedSuspended]);

  const visible = actions.slice(0, visibleCount);
  const overflow = actions.slice(visibleCount);
  // Plain items first, then the flag colour grid pinned to the bottom (with its
  // own top divider), mirroring the note-row menu. Flag only ever collapses
  // after Move, so there's always an item above the grid for the divider.
  const overflowItems: ActionsMenuItem[] = [
    ...overflow.filter((a) => a.key !== "flag").flatMap((a) => a.menuItems),
    ...(overflow.some((a) => a.key === "flag")
      ? [
          {
            render: (close: () => void) => (
              <FlagPicker
                value={0}
                onSelect={(f) => {
                  onBulkFlag(f);
                  close();
                }}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2">
      <div
        ref={containerRef}
        className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden"
      >
        {visible.map((a) => a.button)}
        {overflow.length > 0 && (
          <ActionsMenu
            label="More actions"
            triggerContent={<DotsThree size={20} weight="bold" />}
            triggerClassName={(open) =>
              `${DOTS} transition-colors hover:bg-foreground/5 ${
                open ? "bg-foreground/5" : ""
              }`
            }
            menuClassName="min-w-[160px]"
            items={overflowItems}
          />
        )}
      </div>
      <button
        onClick={onBulkDelete}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
      >
        <Trash size={16} weight="bold" />
        Delete
      </button>
      {/* Off-flow mirror of every button (plus the "⋯" trigger) at full size,
          measured to decide how many fit. Kept in the layout (invisible, not
          display:none) so offsetWidth is real. */}
      <div
        ref={mirrorRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-2"
      >
        {actions.map((a) => a.button)}
        <button className={DOTS} tabIndex={-1}>
          <DotsThree size={20} weight="bold" />
        </button>
      </div>
    </div>
  );
}
