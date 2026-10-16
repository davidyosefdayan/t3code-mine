import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { PIN_EMOJI_CHOICES, setPinIcon, usePinIcon } from "../pinIcons";
import {
  PIN_ICON_COLORS,
  PIN_LINE_ICONS,
  pinLineIcon,
  pinLineIconValue,
  type PinIconColor,
} from "./pinLineIcons";
import { Input } from "./ui/input";
import { Popover, PopoverPopup } from "./ui/popover";

type PickerTab = "icons" | "emoji";

const tabClassName =
  "cursor-pointer rounded-md px-2 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const cellClassName =
  "flex size-8 cursor-pointer items-center justify-center rounded-lg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function matches(words: string, query: string): boolean {
  return words.replaceAll("-", " ").includes(query);
}

// Icon picker for a chat (pinned tile or list row), anchored to it: line icons
// first (in a chosen color), emoji second. Remove returns the tile to its
// project icon.
export function PinIconPicker(props: { threadKey: string | null; onClose: () => void }) {
  const open = props.threadKey !== null;
  return (
    <Popover open={open} onOpenChange={(next) => !next && props.onClose()}>
      {props.threadKey !== null ? (
        <PinIconPickerPopup threadKey={props.threadKey} onClose={props.onClose} />
      ) : null}
    </Popover>
  );
}

function PinIconPickerPopup(props: { threadKey: string; onClose: () => void }) {
  const current = usePinIcon(props.threadKey);
  const currentLine = current === null ? null : pinLineIcon(current);
  const [tab, setTab] = useState<PickerTab>(
    current !== null && currentLine === null ? "emoji" : "icons",
  );
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<PinIconColor | null>(currentLine?.color ?? null);
  const [colorsOpen, setColorsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const anchor = document.querySelector(
    `[data-thread-item="${CSS.escape(props.threadKey)}"] [data-testid^="sidebar-row-"]`,
  );

  const normalizedQuery = query.trim().toLowerCase();
  const icons = PIN_LINE_ICONS.filter(([name]) => matches(name, normalizedQuery));
  const emoji = PIN_EMOJI_CHOICES.filter(([, words]) => matches(words, normalizedQuery));
  const iconColorClassName = color === null ? "text-foreground/80" : PIN_ICON_COLORS[color];

  const choose = (value: string | null) => {
    setPinIcon(props.threadKey, value);
    props.onClose();
  };
  const chooseColor = (next: PinIconColor | null) => {
    setColor(next);
    setColorsOpen(false);
    // Recolor the tile's current icon in place; the picker stays open.
    if (currentLine !== null) setPinIcon(props.threadKey, pinLineIconValue(currentLine.name, next));
  };

  return (
    <PopoverPopup
      anchor={anchor}
      side="bottom"
      align="start"
      sideOffset={6}
      padding="none"
      width="md"
      initialFocus={searchRef}
    >
      <div className="flex items-center gap-0.5 px-2 pt-2" role="tablist">
        {(["icons", "emoji"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              tabClassName,
              tab === value
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "icons" ? "Icons" : "Emoji"}
          </button>
        ))}
        <button
          type="button"
          disabled={current === null}
          onClick={() => choose(null)}
          className={cn(
            tabClassName,
            "ml-auto text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Remove
        </button>
      </div>
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted px-2.5 text-sm text-foreground">
          <SearchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={searchRef}
            unstyled
            nativeInput
            size="sm"
            className="min-w-0 flex-1"
            type="search"
            value={query}
            placeholder="Search…"
            aria-label="Search icons"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        {tab === "icons" ? (
          <button
            type="button"
            aria-label="Icon color"
            aria-expanded={colorsOpen}
            onClick={() => setColorsOpen((value) => !value)}
            className={cn(cellClassName, colorsOpen && "bg-accent")}
          >
            <span
              aria-hidden
              className={cn("size-3.5 rounded-full bg-current", iconColorClassName)}
            />
          </button>
        ) : null}
      </div>
      {tab === "icons" && colorsOpen ? (
        <div className="flex items-center gap-0.5 px-3 pb-1" aria-label="Icon colors">
          <ColorSwatch
            label="Default"
            className="text-foreground/80"
            selected={color === null}
            onClick={() => chooseColor(null)}
          />
          {(Object.keys(PIN_ICON_COLORS) as PinIconColor[]).map((value) => (
            <ColorSwatch
              key={value}
              label={value}
              className={PIN_ICON_COLORS[value]}
              selected={color === value}
              onClick={() => chooseColor(value)}
            />
          ))}
        </div>
      ) : null}
      <div className="h-72 overflow-y-auto px-3 pt-1 pb-3">
        {tab === "icons" ? (
          <div className="grid grid-cols-9 gap-0.5">
            {icons.map(([name, Icon]) => (
              <button
                key={name}
                type="button"
                aria-label={name.replaceAll("-", " ")}
                onClick={() => choose(pinLineIconValue(name, color))}
                className={cn(cellClassName, currentLine?.name === name && "bg-accent")}
              >
                <Icon className={cn("size-4.5", iconColorClassName)} />
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-9 gap-0.5">
            {emoji.map(([value, words]) => (
              <button
                key={value}
                type="button"
                aria-label={words}
                onClick={() => choose(value)}
                className={cn(cellClassName, "text-lg", current === value && "bg-accent")}
              >
                {value}
              </button>
            ))}
          </div>
        )}
        {(tab === "icons" ? icons.length : emoji.length) === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No matches</div>
        ) : null}
      </div>
    </PopoverPopup>
  );
}

function ColorSwatch(props: {
  label: string;
  className: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={cn(cellClassName, "size-7", props.selected && "bg-accent")}
    >
      <span aria-hidden className={cn("size-3.5 rounded-full bg-current", props.className)} />
    </button>
  );
}
