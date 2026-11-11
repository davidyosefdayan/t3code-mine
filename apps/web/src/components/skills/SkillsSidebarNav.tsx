import type { ProviderDriverKind } from "@t3tools/contracts";
import { MessageSquarePlusIcon, PencilLineIcon, SquarePenIcon } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState, type KeyboardEvent } from "react";

import { useFileContextMenuHandler } from "../../fileContextMenu";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { activeSurfaceClassName, restSurfaceClassName } from "../sidebar/ThreadRowParts";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarListGroup, SidebarListLayout } from "../page/SidebarListLayout";
import { ProjectFavicon } from "../ProjectFavicon";
import { ListFilterButton, ListSearchBar } from "../page/ListSearchBar";
import { SOURCE_LABEL, useSkillCreation, useSkillsEnvironments } from "./SkillsPage";
import {
  collectSkillEntries,
  filterSkillEntriesForView,
  formatSkillsView,
  groupSkillEntries,
  parseSkillsView,
  searchSkillEntries,
  type SkillEntry,
  type SkillsView,
} from "./skillsCatalog";

// Personal build: the Skills sidebar is the skill list, like the thread list
// on Threads: search with a filter (every skill, personal, one agent, or one
// project) on top, then skills grouped by agent. The page shows the open skill.
// The view and the open skill live in the URL (?view=, ?skill=).
export function SkillsSidebarNav() {
  const navigate = useNavigate();
  // The sidebar can render a frame apart from the page, so it must not require the match.
  const search = useSearch({ from: "/skills", shouldThrow: false });
  const view = parseSkillsView(search?.view);
  const environments = useSkillsEnvironments();
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const entries = collectSkillEntries(environments);
  const viewEntries = filterSkillEntriesForView(entries, view);
  const searching = query.trim().length > 0;
  const groups = groupSkillEntries(searchSkillEntries(viewEntries, query), {
    keepOrder: searching,
  });
  const ordered = groups.flatMap((group) => group.entries);
  const openKey =
    search?.skill ??
    groupSkillEntries(viewEntries).flatMap((group) => group.entries)[0]?.key ??
    null;

  const selectView = (next: SkillsView) =>
    void navigate({ to: "/skills", search: { view: formatSkillsView(next) } });
  const openSkill = (key: string) =>
    void navigate({ to: "/skills", search: { ...search, skill: key } });

  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (ordered.length === 0) return;
    event.preventDefault();
    const index = ordered.findIndex((entry) => entry.key === openKey);
    const next =
      ordered[
        event.key === "ArrowDown"
          ? Math.min(ordered.length - 1, index + 1)
          : Math.max(0, index === -1 ? 0 : index - 1)
      ];
    if (!next) return;
    openSkill(next.key);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-skill-key="${CSS.escape(next.key)}"]`)
      ?.focus();
  };

  const byInstance = new Map<string, { name: string; driver: ProviderDriverKind }>();
  for (const entry of entries) {
    if (!byInstance.has(entry.instanceId)) {
      byInstance.set(entry.instanceId, { name: entry.providerName, driver: entry.driver });
    }
  }
  const providers = [...byInstance].toSorted(([, left], [, right]) =>
    left.name.localeCompare(right.name),
  );
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const connectedProjects = projects
    .filter((project) => environmentLabels.has(project.environmentId))
    .toSorted((left, right) => left.title.localeCompare(right.title));
  const multipleEnvironments = environments.length > 1;
  const filtered = view.kind !== "all";
  const viewLabel =
    view.kind === "personal"
      ? "Personal"
      : view.kind === "provider"
        ? (byInstance.get(view.instanceId)?.name ?? "Agent")
        : view.kind === "project"
          ? (projects.find(
              (project) =>
                project.environmentId === view.environmentId && project.workspaceRoot === view.cwd,
            )?.title ?? "Project")
          : "All skills";
  const creation = useSkillCreation(view, environments, entries, openSkill);

  return (
    <SidebarListLayout
      header={
        <>
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <ListSearchBar
                value={query}
                onChange={setQuery}
                onArrowDown={() =>
                  listRef.current?.querySelector<HTMLElement>("[data-skill-key]")?.focus()
                }
                placeholder="Search"
                ariaLabel="Search skills"
                actions={
                  <Menu>
                    <MenuTrigger render={<ListFilterButton active={filtered} />} />
                    <MenuPopup align="end" className="max-h-96">
                      <MenuRadioGroup
                        value={formatSkillsView(view) ?? "all"}
                        onValueChange={(value) => selectView(parseSkillsView(String(value)))}
                      >
                        <MenuRadioItem value="all">All skills</MenuRadioItem>
                        <MenuRadioItem value={formatSkillsView({ kind: "personal" })}>
                          Personal
                        </MenuRadioItem>
                        {providers.length > 0 ? (
                          <>
                            <MenuSeparator />
                            <MenuGroup>
                              <MenuGroupLabel>Agents</MenuGroupLabel>
                              {providers.map(([instanceId, provider]) => (
                                <MenuRadioItem
                                  key={instanceId}
                                  value={formatSkillsView({ kind: "provider", instanceId })}
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ProviderInstanceIcon
                                      driverKind={provider.driver}
                                      displayName={provider.name}
                                      className="size-4"
                                      iconClassName="size-4"
                                    />
                                    <span className="truncate">{provider.name}</span>
                                  </span>
                                </MenuRadioItem>
                              ))}
                            </MenuGroup>
                          </>
                        ) : null}
                        {connectedProjects.length > 0 ? (
                          <>
                            <MenuSeparator />
                            <MenuGroup>
                              <MenuGroupLabel>Projects</MenuGroupLabel>
                              {connectedProjects.map((project) => (
                                <MenuRadioItem
                                  key={`${project.environmentId}-${project.id}`}
                                  value={formatSkillsView({
                                    kind: "project",
                                    environmentId: project.environmentId,
                                    cwd: project.workspaceRoot,
                                  })}
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ProjectFavicon project={project} className="size-4" />
                                    <span className="truncate">
                                      {multipleEnvironments
                                        ? `${project.title} · ${environmentLabels.get(project.environmentId)}`
                                        : project.title}
                                    </span>
                                  </span>
                                </MenuRadioItem>
                              ))}
                            </MenuGroup>
                          </>
                        ) : null}
                      </MenuRadioGroup>
                    </MenuPopup>
                  </Menu>
                }
                chips={
                  filtered
                    ? [
                        {
                          key: "view",
                          label: viewLabel,
                          onRemove: () => selectView({ kind: "all" }),
                        },
                      ]
                    : []
                }
              />
            </div>
            {/* Like New thread: its own filled square beside the search. */}
            <span className="flex shrink-0 rounded-lg bg-chip">
              <Menu>
                <MenuTrigger
                  disabled={!creation.canCreate}
                  render={<SidebarHeaderIconButton label="New skill" className="size-8" />}
                >
                  <SquarePenIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem onClick={creation.openWrite}>
                    <PencilLineIcon />
                    Write it yourself
                  </MenuItem>
                  <MenuItem onClick={creation.createWithAi}>
                    <MessageSquarePlusIcon />
                    Create with an agent
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </span>
          </div>
          {creation.dialog}
        </>
      }
    >
        <div
          ref={listRef}
          role="listbox"
          aria-label="Skills"
          tabIndex={-1}
          onKeyDown={moveSelection}
          className="flex flex-col"
        >
          {ordered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-sidebar-muted-foreground">
              {searching ? `Nothing matches “${query.trim()}”.` : "No skills here."}
            </p>
          ) : (
            groups.map((group) => (
              <SidebarListGroup
                key={group.key}
                label={group.label}
                count={group.entries.length}
                expanded={!collapsedGroups.has(group.key)}
                onToggle={() =>
                  setCollapsedGroups((current) => {
                    const next = new Set(current);
                    if (!next.delete(group.key)) next.add(group.key);
                    return next;
                  })
                }
              >
                {group.entries.map((entry) => (
                  <SkillRow
                    key={entry.key}
                    entry={entry}
                    selected={entry.key === openKey}
                    onSelect={() => openSkill(entry.key)}
                  />
                ))}
              </SidebarListGroup>
            ))
          )}
        </div>
    </SidebarListLayout>
  );
}

function SkillRow(props: { entry: SkillEntry; selected: boolean; onSelect: () => void }) {
  const { entry } = props;
  const onContextMenu = useFileContextMenuHandler(entry.environmentId);
  const summary = entry.skill.shortDescription ?? entry.skill.description;
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected}
      data-skill-key={entry.key}
      onClick={props.onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(
          {
            environmentId: entry.environmentId,
            filePath: entry.skill.path,
            workspaceRoot: undefined,
          },
          event,
        );
      }}
      className={cn(
        "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        props.selected ? activeSurfaceClassName : restSurfaceClassName,
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            "truncate text-sm font-medium",
            entry.skill.enabled ? "text-sidebar-foreground" : "text-sidebar-muted-foreground",
          )}
        >
          {entry.displayName}
        </span>
        <span className="ms-auto shrink-0 text-2xs text-sidebar-muted-foreground">
          {entry.skill.enabled
            ? entry.source === "project" || entry.source === "plugin"
              ? SOURCE_LABEL[entry.source]
              : null
            : "Off"}
        </span>
      </span>
      {summary ? (
        <span className="truncate text-xs text-sidebar-muted-foreground">{summary}</span>
      ) : null}
    </button>
  );
}
