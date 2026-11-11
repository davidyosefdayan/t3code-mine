import { isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";

import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

export interface PageSidebarItem {
  readonly id: string;
  readonly label: string;
  /** An icon component, or a rendered icon such as a project favicon. */
  readonly icon: ComponentType | ReactElement;
  readonly active: boolean;
  readonly onSelect: () => void;
  /** A short fact at the row's end, such as a provider's limit left. */
  readonly trailing?: ReactNode;
}

export interface PageSidebarSection {
  readonly label?: string;
  readonly items: ReadonlyArray<PageSidebarItem>;
}

// Shared body for page sidebars that are a plain list of views (Usage, Pull
// requests). Same rows as the Settings sections, so every sidebar reads alike.
export function PageSidebarNav({ sections }: { sections: ReadonlyArray<PageSidebarSection> }) {
  return (
    <SidebarContent className="overflow-x-hidden">
      {sections.map((section, index) => (
        <SidebarGroup key={section.label ?? index}>
          {section.label ? (
            <div className="px-2 pb-1 text-xs font-semibold text-sidebar-muted-foreground">
              {section.label}
            </div>
          ) : null}
          <SidebarMenu>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton isActive={item.active} onClick={item.onSelect}>
                    {isValidElement(Icon) ? Icon : <Icon />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.trailing ? (
                      <span className="shrink-0 text-xs text-sidebar-muted-foreground tabular-nums">
                        {item.trailing}
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </SidebarContent>
  );
}
