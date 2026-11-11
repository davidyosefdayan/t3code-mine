/**
 * Personal build: the filter menu every sidebar list shares, drawn like the
 * Pull requests one: the filter icon opens a menu of submenus, each naming its
 * current choice, with a header and a check on the right inside.
 */
import { useState, type ComponentType, type MouseEvent, type ReactNode } from "react";

import { ListFilterButton } from "./ListSearchBar";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSearchInput,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";

export interface ListFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly icon: ReactNode;
  /** Shown after the label, such as a pin button. */
  readonly trailing?: ReactNode;
  readonly onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
}

export function ListFilterMenu(props: {
  active: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Menu {...(props.onOpenChange ? { onOpenChange: props.onOpenChange } : {})}>
      <MenuTrigger render={<ListFilterButton active={props.active} />} />
      <MenuPopup align="end" side="bottom">
        {props.children}
      </MenuPopup>
    </Menu>
  );
}

export function listFilterIcon(Icon: ComponentType<{ className?: string }>) {
  return <Icon aria-hidden className="size-3.5" />;
}

function OptionRow<Value extends string>({
  option,
  indicator,
}: {
  option: ListFilterOption<Value>;
  indicator?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {option.icon}
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      {/* Trailing buttons sit in the row's padding, so every row keeps one height. */}
      {option.trailing ? <span className="-my-1 flex items-center">{option.trailing}</span> : null}
      {indicator}
    </span>
  );
}

function useOptionSearch<Value extends string>(
  options: ReadonlyArray<ListFilterOption<Value>>,
  alwaysSearchable: boolean | undefined,
  label: string,
) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const searchable = alwaysSearchable === true;
  return {
    search: searchable ? (
      <MenuSearchInput
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder={`Search ${label.toLowerCase()}s`}
        aria-label={`Search ${label.toLowerCase()}s`}
      />
    ) : null,
    visible:
      needle === ""
        ? options
        : options.filter((option) => option.label.toLowerCase().includes(needle)),
  };
}

function SubmenuTrigger(props: { label: string; icon: ReactNode; summary: string }) {
  return (
    <MenuSubTrigger>
      {props.icon}
      <span className="flex-1">{props.label}</span>
      <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
        {props.summary}
      </span>
    </MenuSubTrigger>
  );
}

/** One choice, like a pull request's State. */
export function ListFilterSubmenu<Value extends string>(props: {
  label: string;
  value: Value;
  options: ReadonlyArray<ListFilterOption<Value>>;
  onChange: (value: Value) => void;
  /** Offer a search box, as project lists do. */
  searchable?: boolean;
}) {
  const { search, visible } = useOptionSearch(props.options, props.searchable, props.label);
  const current = props.options.find((option) => option.value === props.value) ?? props.options[0];
  if (!current) return null;
  return (
    <MenuSub>
      <SubmenuTrigger label={props.label} icon={current.icon} summary={current.label} />
      <MenuSubPopup className="max-h-96">
        {search}
        <MenuRadioGroup
          value={props.value}
          onValueChange={(next) => {
            if (next !== props.value) props.onChange(next as Value);
          }}
        >
          <MenuGroupLabel>{props.label}</MenuGroupLabel>
          {visible.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              {...(option.onContextMenu ? { onContextMenu: option.onContextMenu } : {})}
            >
              <OptionRow option={option} indicator={<MenuRadioItemIndicator />} />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {visible.length === 0 ? <MenuItem disabled>Nothing matches</MenuItem> : null}
      </MenuSubPopup>
    </MenuSub>
  );
}

/** Several choices, with "All" first: none picked means everything. */
export function ListFilterMultiSubmenu<Value extends string>(props: {
  label: string;
  all: ListFilterOption<"all">;
  values: ReadonlyArray<Value>;
  options: ReadonlyArray<ListFilterOption<Value>>;
  onToggle: (value: Value) => void;
  onClear: () => void;
  /** Offer a search box, as project lists do. */
  searchable?: boolean;
}) {
  const { search, visible } = useOptionSearch(props.options, props.searchable, props.label);
  const selected = new Set<string>(props.values);
  const first = props.options.find((option) => selected.has(option.value));
  const summary =
    props.values.length === 0
      ? props.all.label
      : props.values.length === 1 && first
        ? first.label
        : `${props.values.length} selected`;
  return (
    <MenuSub>
      <SubmenuTrigger
        label={props.label}
        icon={props.values.length === 1 && first ? first.icon : props.all.icon}
        summary={summary}
      />
      <MenuSubPopup className="max-h-96">
        {search}
        <MenuGroup>
          <MenuGroupLabel>{props.label}</MenuGroupLabel>
          <MenuCheckboxItem
            variant="check"
            checked={props.values.length === 0}
            onCheckedChange={props.onClear}
          >
            <OptionRow option={props.all} />
          </MenuCheckboxItem>
          {visible.map((option) => (
            <MenuCheckboxItem
              key={option.value}
              variant="check"
              checked={selected.has(option.value)}
              onCheckedChange={() => props.onToggle(option.value)}
              {...(option.onContextMenu ? { onContextMenu: option.onContextMenu } : {})}
            >
              <OptionRow option={option} />
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        {visible.length === 0 ? <MenuItem disabled>Nothing matches</MenuItem> : null}
      </MenuSubPopup>
    </MenuSub>
  );
}
