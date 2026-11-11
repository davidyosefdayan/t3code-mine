/**
 * Personal build: the Threads filter, the shared list filter menu with State
 * and Project. Projects keep their pin (pinned ones come first in every
 * project picker), and a right-click opens project settings.
 */
import { CircleDotIcon, LayersIcon, MessagesSquareIcon } from "lucide-react";
import { useState, type ComponentProps, type MouseEvent as ReactMouseEvent } from "react";

import { useOrderWhileOpen } from "../../hooks/useOrderWhileOpen";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import {
  ListFilterMenu,
  ListFilterMultiSubmenu,
  ListFilterSubmenu,
  listFilterIcon,
} from "../page/ListFilterMenu";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProjectPinButton } from "../ProjectPinButton";
import { MenuSeparator } from "../ui/menu";

const STATE_OPTIONS = [
  { value: "all", label: "All threads", icon: listFilterIcon(MessagesSquareIcon) },
  { value: "unread", label: "Unread", icon: listFilterIcon(CircleDotIcon) },
] as const;

export function ThreadFiltersMenu(props: {
  unreadOnly: boolean;
  onUnreadOnlyChange: (unreadOnly: boolean) => void;
  /** Pickable projects, pinned first. */
  projects: ReadonlyArray<SidebarProjectSnapshot>;
  selectedKeys: ReadonlyArray<string>;
  onToggleProject: (projectKey: string) => void;
  onClearProjects: () => void;
  canPin: (project: SidebarProjectSnapshot) => boolean;
  onTogglePin: (project: SidebarProjectSnapshot) => void;
  pinShortcutLabel: string | null;
  onProjectSettings: (event: ReactMouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
  /** With projects on several machines, each row names its machine. */
  environmentBadge: Omit<ComponentProps<typeof ProjectEnvironmentBadge>, "group"> | null;
}) {
  const [open, setOpen] = useState(false);
  // Pinning a row doesn't move it while the menu is open.
  const projects = useOrderWhileOpen(props.projects, (project) => project.projectKey, open);
  const { environmentBadge } = props;
  return (
    <ListFilterMenu
      active={props.unreadOnly || props.selectedKeys.length > 0}
      onOpenChange={setOpen}
    >
      <ListFilterSubmenu
        label="State"
        value={props.unreadOnly ? "unread" : "all"}
        options={STATE_OPTIONS}
        onChange={(next) => props.onUnreadOnlyChange(next === "unread")}
      />
      {projects.length > 0 ? (
        <>
          <MenuSeparator />
          <ListFilterMultiSubmenu
            label="Project"
            searchable
            all={{ value: "all", label: "All projects", icon: listFilterIcon(LayersIcon) }}
            values={props.selectedKeys}
            options={projects.map((project) => ({
              value: project.projectKey,
              label: project.displayName,
              icon: <ProjectFavicon project={project} className="size-3.5 shrink-0" />,
              trailing: (
                <>
                  {environmentBadge ? (
                    <ProjectEnvironmentBadge group={project} {...environmentBadge} />
                  ) : null}
                  {props.canPin(project) ? (
                    <ProjectPinButton
                      name={project.displayName}
                      pinned={project.pinned}
                      shortcutLabel={props.pinShortcutLabel}
                      onToggle={() => props.onTogglePin(project)}
                    />
                  ) : null}
                </>
              ),
              onContextMenu: (event: ReactMouseEvent<HTMLElement>) =>
                props.onProjectSettings(event, project),
            }))}
            onToggle={props.onToggleProject}
            onClear={props.onClearProjects}
          />
        </>
      ) : null}
    </ListFilterMenu>
  );
}
