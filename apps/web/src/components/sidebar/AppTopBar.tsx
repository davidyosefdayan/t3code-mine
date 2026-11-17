import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAtomValue } from "@effect/atom-react";
import { useCanGoBack, useLocation, useRouter } from "@tanstack/react-router";
import type { ContextMenuItem } from "@t3tools/contracts";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, PinIcon, SearchIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { onQuickActionRan, openCommandPalette } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { usePinnedQuickActions } from "../../quickActions";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { T3Wordmark } from "../T3Wordmark";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { UsageQuickAction } from "./UsageQuickAction";

// The router only reports back history. Chromium's Navigation API knows about
// forward entries too; re-read it whenever the location changes. Where the API
// is missing, forward stays enabled (the old behavior).
function useCanGoForward(): boolean {
  useLocation({ select: (location) => location.href });
  const navigation = (window as { navigation?: { canGoForward?: boolean } }).navigation;
  return navigation?.canGoForward ?? true;
}

function TopBarButton(props: {
  label: string;
  disabled?: boolean;
  /** Greys the button but keeps its tooltip, which says it can't run here. */
  unavailable?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const unavailable = props.unavailable === true;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            aria-disabled={unavailable || undefined}
            disabled={props.disabled}
            onClick={unavailable ? undefined : props.onClick}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-sidebar-muted-foreground [&_svg]:size-4"
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {unavailable ? `“${props.label}” isn’t available on this screen` : props.label}
      </TooltipPopup>
    </Tooltip>
  );
}

// Personal build: quick actions pinned from the command palette. Drag to reorder; right-click
// to move or unpin. With none pinned, a hint says how to pin.
const PIN_DRAG_MODIFIERS = [restrictToHorizontalAxis];
type PinMenuAction = "move-left" | "move-right" | "unpin";

const COPIED_CHECK_MS = 1500;

/** The copy action that just finished, for a moment, so its pin can show a check. */
function useJustCopied(): string | null {
  const [copied, setCopied] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the palette's "action ran" event and clears after a delay
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onQuickActionRan((value) => {
      if (!value.startsWith("action:copy-")) return;
      clearTimeout(timer);
      setCopied(value);
      timer = setTimeout(() => setCopied(null), COPIED_CHECK_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);
  return copied;
}

function PinnedQuickActions(props: { readonly pinShortcut: string | null }) {
  const { actions, unpin, move } = usePinnedQuickActions();
  const justCopied = useJustCopied();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // A drag ends with a click on the dragged button; it must not run the action.
  const draggedRef = useRef(false);
  if (actions.length === 0) {
    const hint = props.pinShortcut
      ? `Pin commands here: in the command palette, highlight one and press ${props.pinShortcut} or click its pin`
      : "Pin commands here: in the command palette, click a command's pin";
    return (
      <TopBarHint label={hint} onClick={() => openCommandPalette()}>
        <PinIcon className="size-3.5" />
        Pin actions
      </TopBarHint>
    );
  }
  const values = actions.map((action) => action.value);
  const showMenu = async (event: ReactMouseEvent, value: string) => {
    event.preventDefault();
    const api = readLocalApi();
    if (!api) return;
    const index = values.indexOf(value);
    const items: ContextMenuItem<PinMenuAction>[] = [
      { id: "move-left", label: "Move left", disabled: index <= 0 },
      { id: "move-right", label: "Move right", disabled: index >= values.length - 1 },
      { id: "unpin", label: "Unpin from top bar", icon: "pin-off", separatorBefore: true },
    ];
    const choice = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    if (choice === "move-left") move(value, index - 1);
    else if (choice === "move-right") move(value, index + 1);
    else if (choice === "unpin") unpin(value);
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(String(active.id), values.indexOf(String(over.id)));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={PIN_DRAG_MODIFIERS}
      onDragStart={() => {
        draggedRef.current = true;
      }}
      onDragEnd={(event) => {
        handleDragEnd(event);
        setTimeout(() => {
          draggedRef.current = false;
        });
      }}
    >
      <SortableContext items={values} strategy={horizontalListSortingStrategy}>
        {actions.map(({ value, title, Icon, run, available }) => (
          <SortablePin
            key={value}
            value={value}
            onContextMenu={(event) => void showMenu(event, value)}
            onClickCapture={(event) => {
              if (draggedRef.current) event.stopPropagation();
            }}
          >
            {value === "action:usage" ? (
              <UsageQuickAction onClick={run} />
            ) : (
              <TopBarButton
                label={justCopied === value ? "Copied" : title}
                unavailable={!available}
                onClick={run}
              >
                {justCopied === value ? <CheckIcon /> : <Icon />}
              </TopBarButton>
            )}
          </SortablePin>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortablePin(props: {
  readonly value: string;
  readonly onContextMenu: (event: ReactMouseEvent) => void;
  readonly onClickCapture: (event: ReactMouseEvent) => void;
  readonly children: ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.value,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      onContextMenu={props.onContextMenu}
      onClickCapture={props.onClickCapture}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex [-webkit-app-region:no-drag]", isDragging && "relative z-10")}
    >
      {props.children}
    </div>
  );
}

function TopBarHint(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={props.onClick}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-sidebar-border px-2.5 text-xs text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom" className="max-w-64">
        {props.label}
      </TooltipPopup>
    </Tooltip>
  );
}

// The window's top strip (like Slack and ChatGPT): the macOS window buttons,
// the app name, history navigation, and a search field that opens the command
// palette. The rail and panel start below it; sidebar toggles stay in the
// sidebars themselves.
export function AppTopBar() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const canGoForward = useCanGoForward();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const shortcut = (command: "commandPalette.toggle") =>
    shortcutLabelForCommand(keybindings, command, { context: { usagePageOpen } });
  const paletteShortcut = shortcut("commandPalette.toggle");
  const pinShortcut = shortcutLabelForCommand(keybindings, "thread.pin");
  return (
    <header
      data-app-topbar=""
      // pt-2 matches the panel's 0.5rem top margin, so the controls center between
      // the window top and the panel rather than within the bar alone. On Windows
      // and Linux the native window buttons overlay the bar's right end.
      className="drag-region fixed inset-x-0 top-0 z-30 hidden h-(--app-topbar-height) grid-cols-[minmax(max-content,1fr)_minmax(0,36rem)_minmax(max-content,1fr)] items-center gap-3 bg-sidebar-shell ps-(--app-topbar-start) pe-(--app-topbar-end) pt-2 md:grid [&_button]:[-webkit-app-region:no-drag]"
    >
      <div className="flex items-center gap-0.5">
        <span className="me-2 inline-flex items-baseline gap-1 text-sm font-medium tracking-tight text-sidebar-foreground">
          <T3Wordmark aria-label="T3" className="h-[1cap] w-auto shrink-0" />
          <span className="text-sidebar-muted-foreground">Code</span>
        </span>
        <TopBarButton label="Back" disabled={!canGoBack} onClick={() => router.history.back()}>
          <ArrowLeftIcon />
        </TopBarButton>
        <TopBarButton
          label="Forward"
          disabled={!canGoForward}
          onClick={() => router.history.forward()}
        >
          <ArrowRightIcon />
        </TopBarButton>
      </div>
      <button
        type="button"
        onClick={() => openCommandPalette()}
        className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-lg bg-chip px-2.5 text-start text-xs text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search threads, projects, and commands</span>
        {paletteShortcut ? (
          <kbd className="shrink-0 font-sans text-2xs opacity-70">{paletteShortcut}</kbd>
        ) : null}
      </button>
      {/* Personal build: search sits in the middle, pinned quick actions on the right. */}
      <div className="flex min-w-0 items-center justify-end gap-1">
        <PinnedQuickActions pinShortcut={pinShortcut} />
      </div>
    </header>
  );
}
