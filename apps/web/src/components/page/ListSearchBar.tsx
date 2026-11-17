/**
 * Personal build: one search bar for every sidebar list (pull requests, and
 * next threads and skills): search, then sort and filter as icons at the end
 * of the field, and a row of removable chips for the filters that are on.
 */
import { ArrowDownUpIcon, ListFilterIcon, SearchIcon, XIcon } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";

import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarInput } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";

export interface ListFilterChip {
  readonly key: string;
  readonly label: string;
  readonly onRemove: () => void;
}

export function ListSearchBar(props: {
  value: string;
  onChange: (value: string) => void;
  /** Enter, or a paste: run the search now rather than as typed. */
  onSubmit?: (value: string) => void;
  /** Down arrow in the field: move focus into the list. */
  onArrowDown?: () => void;
  placeholder: string;
  ariaLabel: string;
  /** A search in flight: a spinner replaces the search icon. */
  busy?: boolean;
  /** Icon buttons at the end of the field: sort, then filter. */
  actions?: ReactNode;
  chips?: ReadonlyArray<ListFilterChip>;
  onClearChips?: () => void;
}) {
  // While focused the field keeps what was typed, so a slower update of
  // `value` (from the URL, say) can't rewrite it mid-word.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? props.value;
  const chips = props.chips ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex h-8 min-w-0 items-center gap-2 rounded-lg bg-chip ps-2.5 pe-0.5 text-sm text-sidebar-muted-foreground">
        {props.busy ? (
          <Spinner aria-hidden className="size-3.5 shrink-0" />
        ) : (
          <SearchIcon className="size-3.5 shrink-0 text-(--sidebar-icon-color)" />
        )}
        <SidebarInput
          nativeInput
          type="search"
          value={shown}
          onFocus={() => setDraft(props.value)}
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            props.onChange(event.currentTarget.value);
            if ((event.nativeEvent as InputEvent).inputType === "insertFromPaste") {
              props.onSubmit?.(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && props.onArrowDown) {
              event.preventDefault();
              props.onArrowDown();
            }
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              props.onSubmit?.(event.currentTarget.value);
            }
            if (event.key === "Escape" && shown) {
              event.preventDefault();
              setDraft("");
              props.onChange("");
            }
          }}
          placeholder={props.placeholder}
          aria-label={props.ariaLabel}
          className="min-w-0 flex-1"
        />
        {shown ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            className="shrink-0"
            aria-label="Clear search"
            onClick={() => {
              setDraft(null);
              props.onChange("");
            }}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
        {props.actions ? <span className="flex shrink-0 gap-0.5">{props.actions}</span> : null}
      </div>
      <ListFilterChips chips={chips} onClear={props.onClearChips} />
    </div>
  );
}

/** The filters that are on, each removable, under a search bar. */
export function ListFilterChips(props: {
  chips: ReadonlyArray<ListFilterChip>;
  onClear?: (() => void) | undefined;
}) {
  if (props.chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {props.chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          aria-label={`Remove filter: ${chip.label}`}
          className="inline-flex h-6 max-w-full cursor-pointer items-center gap-1 rounded-md bg-chip ps-2 pe-1.5 text-xs text-sidebar-foreground outline-none hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="truncate">{chip.label}</span>
          <XIcon aria-hidden className="size-3 shrink-0 text-sidebar-muted-foreground" />
        </button>
      ))}
      {props.onClear && props.chips.length > 1 ? (
        <Button variant="ghost-muted" size="xs" onClick={props.onClear}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}

export interface ListSortOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly Icon?: ComponentType<{ className?: string }>;
}

/** The filter icon in a `ListSearchBar`, for a menu's trigger; lit while any filter is on. */
export function ListFilterButton({ active, ...props }: { active: boolean }) {
  return (
    <SidebarHeaderIconButton
      {...props}
      label={active ? "Filters (on)" : "Filters"}
      isActive={active}
    >
      <ListFilterIcon className="size-4" />
    </SidebarHeaderIconButton>
  );
}

/** The sort icon in a `ListSearchBar`; lit while the order isn't the default. */
export function ListSortMenu<Value extends string, Direction extends string = string>(props: {
  value: Value;
  defaultValue: Value;
  options: ReadonlyArray<ListSortOption<Value>>;
  onChange: (value: Value) => void;
  /** A second choice, such as newest or oldest first, for sorts that have one. */
  direction?:
    | {
        value: Direction;
        options: ReadonlyArray<ListSortOption<Direction>>;
        onChange: (value: Direction) => void;
      }
    | undefined;
}) {
  const current = props.options.find((option) => option.value === props.value);
  const direction = props.direction;
  return (
    <Menu>
      <MenuTrigger
        render={
          <SidebarHeaderIconButton
            label={current ? `Sort: ${current.label}` : "Sort"}
            isActive={props.value !== props.defaultValue}
          />
        }
      >
        <ArrowDownUpIcon className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Sort by</MenuGroupLabel>
          <MenuRadioGroup
            value={props.value}
            onValueChange={(next) => props.onChange(next as Value)}
          >
            {props.options.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                <span className="flex min-w-0 items-center gap-2">
                  {option.Icon ? <option.Icon className="size-4 shrink-0" /> : null}
                  <span className="truncate">{option.label}</span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        {direction ? <MenuSeparator /> : null}
        {direction ? (
          <MenuGroup>
            <MenuGroupLabel>Order</MenuGroupLabel>
            <MenuRadioGroup
              value={direction.value}
              onValueChange={(next) => direction.onChange(next as Direction)}
            >
              {direction.options.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  <span className="truncate">{option.label}</span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
