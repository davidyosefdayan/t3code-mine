import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAtomValue } from "@effect/atom-react";
import { useCanGoBack, useLocation, useRouter } from "@tanstack/react-router";
import type { ContextMenuItem } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  PinIcon,
  SearchIcon,
} from "lucide-react";
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
import { observeResize } from "../../lib/observeResize";
import { readLocalApi } from "../../localApi";
import { usePinnedQuickActions } from "../../quickActions";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { T3Wordmark } from "../T3Wordmark";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
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
const PIN_GAP_PX = 4;
const PIN_FALLBACK_WIDTH_PX = 28;

/**
 * How many pins fit from the start of the row in `available` pixels. When some don't fit, the
 * overflow arrow takes a pin's room at the end.
 */
function fittingPinCount(widths: readonly number[], available: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + PIN_GAP_PX * (widths.length - 1);
  if (total <= available) return widths.length;
  let used = PIN_FALLBACK_WIDTH_PX;
  let count = 0;
  for (const width of widths) {
    if (used + PIN_GAP_PX + width > available) break;
    used += PIN_GAP_PX + width;
    count += 1;
  }
  return count;
}

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
  const [visibleCount, setVisibleCount] = useState(Number.POSITIVE_INFINITY);
  // Widths of pins once seen; a hidden pin isn't laid out, so its last width stands in.
  const pinWidthsRef = useRef(new Map<string, number>());
  const measureRow = (row: HTMLDivElement | null) => {
    const container = row?.parentElement;
    if (!row || !container) return;
    const fit = () => {
      const widths = [...row.querySelectorAll<HTMLElement>("[data-pin-value]")].map((pin) => {
        const value = pin.dataset.pinValue ?? "";
        if (pin.offsetWidth > 0) pinWidthsRef.current.set(value, pin.offsetWidth);
        return pinWidthsRef.current.get(value) ?? PIN_FALLBACK_WIDTH_PX;
      });
      setVisibleCount(fittingPinCount(widths, container.clientWidth));
    };
    // The row resizes when pins change or one shows or hides; the container when the window does.
    return observeResize([container, row], fit);
  };
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
      <div ref={measureRow} className="flex min-w-0 items-center gap-1">
        <SortableContext items={values} strategy={horizontalListSortingStrategy}>
          {actions.map(({ value, title, Icon, run, available }, index) => (
            <SortablePin
              key={value}
              value={value}
              hidden={index >= visibleCount}
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
      </div>
      {visibleCount < actions.length ? (
        <PinOverflowMenu actions={actions.slice(visibleCount)} />
      ) : null}
    </DndContext>
  );
}

/** The pins that don't fit, behind an arrow at the end of the row. */
function PinOverflowMenu(props: {
  readonly actions: ReadonlyArray<ReturnType<typeof usePinnedQuickActions>["actions"][number]>;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label="More pinned actions"
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-row-hover data-popup-open:text-sidebar-foreground [&_svg]:size-4"
                />
              }
            />
          }
        >
          <ChevronDownIcon />
        </TooltipTrigger>
        <TooltipPopup side="bottom">More pinned actions</TooltipPopup>
      </Tooltip>
      <MenuPopup side="bottom" align="end">
        {props.actions.map(({ value, title, Icon, run, available }) => (
          <MenuItem key={value} disabled={!available} onClick={run}>
            <Icon />
            {title}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function SortablePin(props: {
  readonly value: string;
  readonly hidden: boolean;
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
      data-pin-value={props.value}
      {...listeners}
      onContextMenu={props.onContextMenu}
      onClickCapture={props.onClickCapture}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex shrink-0 [-webkit-app-region:no-drag]",
        isDragging && "relative z-10",
        props.hidden && "hidden",
      )}
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
  // The search stays centred in the window, as wide as the room beside the app name allows; the
  // pins take what is left on the right.
  const measureStart = (start: HTMLDivElement | null) => {
    const header = start?.parentElement;
    if (!start || !header) return;
    return observeResize(start, () =>
      header.style.setProperty("--topbar-start-width", `${start.offsetWidth}px`),
    );
  };
  return (
    <header
      data-app-topbar=""
      // pt-2 matches the panel's 0.5rem top margin, so the controls center between
      // the window top and the panel rather than within the bar alone. On Windows
      // and Linux the native window buttons overlay the bar's right end.
      className="drag-region fixed inset-x-0 top-0 z-30 flex h-(--app-topbar-height) items-center bg-sidebar-shell ps-(--app-topbar-start) pe-(--app-topbar-end) pt-2 [--topbar-search:min(36rem,max(2.25rem,calc(100%-2*(var(--app-topbar-start)+var(--topbar-start-width,8rem)+0.75rem))))] [&_button]:[-webkit-app-region:no-drag]"
    >
      <div ref={measureStart} className="flex shrink-0 items-center gap-0.5">
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
      <div className="@container absolute inset-y-0 top-2 left-1/2 flex w-(--topbar-search) -translate-x-1/2 items-center">
        <button
          type="button"
          aria-label="Search threads, projects, and commands"
          onClick={() => openCommandPalette()}
          className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-lg bg-chip px-2.5 text-start text-xs text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <SearchIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate @max-[6rem]:hidden">
            Search threads, projects, and commands
          </span>
          {paletteShortcut ? (
            <kbd className="shrink-0 font-sans text-2xs opacity-70 @max-[12rem]:hidden">
              {paletteShortcut}
            </kbd>
          ) : null}
        </button>
      </div>
      {/* Personal build: pinned quick actions fill the room right of the search. */}
      <div className="absolute inset-y-0 top-2 right-(--app-topbar-end) left-[calc(50%+var(--topbar-search)/2+0.75rem)] flex min-w-0 items-center justify-end gap-1">
        <PinnedQuickActions pinShortcut={pinShortcut} />
      </div>
    </header>
  );
}
