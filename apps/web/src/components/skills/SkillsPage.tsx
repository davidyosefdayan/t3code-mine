import { AuthProvidersManageScope } from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  FolderOpenIcon,
  MessageSquarePlusIcon,
  PencilLineIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { isElectron } from "../../env";
import { useOpenInPreferredEditor } from "../../editorPreferences";
import { useFileContextMenu, useFileContextMenuHandler } from "../../fileContextMenu";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn, isMacPlatform } from "../../lib/utils";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { StartTruncatedPath } from "../StartTruncatedPath";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { RefreshIcon } from "../ui/refresh-icon";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { SkillCreateDialog, type SkillCreateTarget } from "./SkillCreateDialog";
import { SkillsIcon } from "./SkillsIcon";
import { useSkillActions } from "./useSkillActions";
import {
  buildCreateSkillPrompt,
  buildEditSkillPrompt,
  collectSkillEntries,
  isSkillManageable,
  personalSkillsRoot,
  filterSkillEntriesForView,
  groupSkillEntries,
  searchSkillEntries,
  skillDirectory,
  skillInvocationLabel,
  stripSkillFrontmatter,
  type SkillEntry,
  type SkillSource,
  type SkillsEnvironmentInput,
  type SkillsView,
} from "./skillsCatalog";

const SOURCE_LABEL: Record<SkillSource, string> = {
  personal: "Personal",
  project: "Project",
  plugin: "Plugin",
  system: "Built in",
};

/** Connected environments' providers, the input every skills view starts from. */
export function useSkillsEnvironments(): SkillsEnvironmentInput[] {
  const { environments } = useEnvironments();
  return useMemo(
    () =>
      environments.flatMap((environment) =>
        environment.connection.phase === "connected" && environment.serverConfig
          ? [
              {
                environmentId: environment.environmentId,
                label: environment.label,
                providers: environment.serverConfig.providers,
              },
            ]
          : [],
      ),
    [environments],
  );
}

export function SkillsPage({ view }: { view: SkillsView }) {
  const environments = useSkillsEnvironments();
  const projects = useProjects();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scanningProject, setScanningProject] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const actions = useSkillActions();

  const entries = useMemo(() => collectSkillEntries(environments), [environments]);
  const viewEntries = useMemo(() => filterSkillEntriesForView(entries, view), [entries, view]);
  const visible = useMemo(() => searchSkillEntries(viewEntries, query), [viewEntries, query]);
  const searching = query.trim().length > 0;
  const groups = useMemo(
    () => groupSkillEntries(visible, { keepOrder: searching }),
    [visible, searching],
  );
  const ordered = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  // An explicit pick wins; otherwise the first skill shows, so the detail pane
  // is never empty on a wide window.
  const selected = ordered.find((entry) => entry.key === selectedKey) ?? ordered[0] ?? null;

  const projectTitle =
    view.kind === "project"
      ? (projects.find(
          (project) =>
            project.environmentId === view.environmentId && project.workspaceRoot === view.cwd,
        )?.title ?? view.cwd)
      : null;
  const viewLabel =
    view.kind === "all"
      ? "All skills"
      : view.kind === "personal"
        ? "Personal"
        : view.kind === "provider"
          ? (entries.find((entry) => entry.instanceId === view.instanceId)?.providerName ??
            view.instanceId)
          : projectTitle;

  // New skills go to the project being viewed, else the first connected
  // machine, for each provider whose skills T3 Code can manage. Codex comes
  // first so its folder holds the real copy: `.agents/skills` is the shared
  // convention, and Claude Code follows the link.
  const createEnvironment =
    (view.kind === "project"
      ? environments.find((environment) => environment.environmentId === view.environmentId)
      : undefined) ?? environments[0];
  // Managing skills changes what providers load, so it takes the provider scope.
  const canManageSkills = useEnvironmentScope(
    createEnvironment?.environmentId ?? null,
    AuthProvidersManageScope,
  );
  const createTargets: SkillCreateTarget[] = (
    canManageSkills ? (createEnvironment?.providers ?? []) : []
  )
    .filter((provider) => provider.enabled && isSkillManageable(provider.driver))
    .toSorted((left, right) => Number(right.driver === "codex") - Number(left.driver === "codex"))
    .map((provider) => ({
      instanceId: provider.instanceId,
      driver: provider.driver,
      providerName:
        entries.find((entry) => entry.instanceId === provider.instanceId)?.providerName ??
        provider.displayName ??
        provider.driver,
      accentColor: provider.accentColor,
    }));
  const createProjectRoot = view.kind === "project" ? view.cwd : undefined;
  const createWithAi = () => {
    if (!createEnvironment) return;
    const prompt = buildCreateSkillPrompt(
      createTargets.flatMap((target) => {
        const root =
          createProjectRoot === undefined
            ? personalSkillsRoot(entries, target)
            : target.driver === "codex"
              ? ".agents/skills"
              : ".claude/skills";
        return root ? [{ providerName: target.providerName, root }] : [];
      }),
    );
    void actions.startChat(createEnvironment.environmentId, prompt, createProjectRoot);
  };

  // A project's skills only exist once its providers have scanned the folder,
  // which the composer otherwise does on first use. Opening the project here
  // scans it, and Refresh rescans.
  const scanProject = async (fresh: boolean) => {
    if (view.kind !== "project") return;
    const environment = environments.find((entry) => entry.environmentId === view.environmentId);
    if (!environment) return;
    const pending = environment.providers.filter(
      (provider) =>
        provider.enabled &&
        (fresh || !provider.workspaceSnapshots?.some((snapshot) => snapshot.cwd === view.cwd)),
    );
    if (pending.length === 0) return;
    setScanningProject(view.cwd);
    try {
      // A fresh scan drops every other provider's scan of the project, so
      // only the first is fresh and the rest refill after it, one at a time.
      for (const [index, provider] of pending.entries()) {
        await refreshProviders({
          environmentId: view.environmentId,
          input: {
            instanceId: provider.instanceId,
            cwd: view.cwd,
            ...(fresh && index === 0 ? { fresh } : {}),
          },
        });
      }
    } finally {
      setScanningProject((current) => (current === view.cwd ? null : current));
    }
  };
  const scanProjectOnOpen = useEffectEvent(() => void scanProject(false));
  const projectKey = view.kind === "project" ? `${view.environmentId}:${view.cwd}` : null;
  const environmentConnected =
    view.kind === "project" &&
    environments.some((environment) => environment.environmentId === view.environmentId);
  useEffect(() => {
    if (projectKey !== null && environmentConnected) scanProjectOnOpen();
  }, [projectKey, environmentConnected]);

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    const work =
      view.kind === "project"
        ? scanProject(true)
        : Promise.all(
            environments.map((environment) =>
              refreshProviders({ environmentId: environment.environmentId, input: {} }),
            ),
          );
    void work.finally(() => setRefreshing(false));
  };

  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (ordered.length === 0) return;
    event.preventDefault();
    const index = selected ? ordered.indexOf(selected) : -1;
    const next =
      ordered[
        event.key === "ArrowDown"
          ? Math.min(ordered.length - 1, index + 1)
          : Math.max(0, index === -1 ? 0 : index - 1)
      ];
    if (!next) return;
    setSelectedKey(next.key);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-skill-key="${CSS.escape(next.key)}"]`)
      ?.focus();
  };

  const scanning = scanningProject !== null && view.kind === "project";
  const body: ReactNode =
    environments.length === 0 ? (
      <SkillsEmptyState
        title="No environment connected"
        description="Skills come from the providers on a connected T3 Code server."
      />
    ) : viewEntries.length === 0 ? (
      scanning ? (
        <SkillsListSkeleton />
      ) : (
        <SkillsEmptyState
          title={view.kind === "project" ? "No skills in this project" : "No skills yet"}
          description={
            view.kind === "project"
              ? "Project skills live in folders like .claude/skills or .agents/skills, one folder per skill with a SKILL.md."
              : "Skills your providers can use show up here, from your personal skill folders, projects, and plugins."
          }
        />
      )
    ) : ordered.length === 0 ? (
      <SkillsEmptyState
        title="No matching skills"
        description={`Nothing matches “${query.trim()}”.`}
      />
    ) : (
      <div className="@container/skills flex min-h-0 flex-1">
        <div
          className={cn(
            "flex min-h-0 w-full flex-col border-border/60 @3xl/skills:w-80 @3xl/skills:shrink-0 @3xl/skills:border-e @5xl/skills:w-96",
            selectedKey !== null && "@max-3xl/skills:hidden",
          )}
        >
          <ScrollArea className="min-h-0 flex-1" scrollFade>
            <div
              ref={listRef}
              role="listbox"
              aria-label="Skills"
              tabIndex={-1}
              onKeyDown={moveSelection}
              className="flex flex-col gap-4 px-2 py-3"
            >
              {groups.map((group) => (
                <SkillGroupList
                  key={group.key}
                  label={group.label}
                  entries={group.entries}
                  selectedKey={selected?.key ?? null}
                  onSelect={setSelectedKey}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
        <div
          className={cn("min-h-0 min-w-0 flex-1", selectedKey === null && "@max-3xl/skills:hidden")}
        >
          {selected ? (
            <SkillDetail
              key={selected.key}
              entry={selected}
              entries={entries}
              actions={actions}
              onBack={selectedKey === null ? undefined : () => setSelectedKey(null)}
            />
          ) : null}
        </div>
      </div>
    );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {/* Right edge on the titlebar-controls inset, like Usage, so refresh
            lines up with the panel toggle on the thread pages. */}
        <WorkspacePageHeader electron={isElectron} className="pr-(--workspace-controls-right)">
          <WorkspaceBreadcrumb ariaLabel="Skills breadcrumb" className="min-w-0">
            <WorkspaceBreadcrumbItem current={view.kind === "all"}>
              <h1>Skills</h1>
            </WorkspaceBreadcrumbItem>
            {view.kind === "all" ? null : (
              <>
                <WorkspaceBreadcrumbSeparator />
                <WorkspaceBreadcrumbItem current className="min-w-0">
                  <span className="truncate">{viewLabel}</span>
                </WorkspaceBreadcrumbItem>
              </>
            )}
          </WorkspaceBreadcrumb>
          {viewEntries.length > 0 ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {viewEntries.length}
            </span>
          ) : null}
          <div className="min-w-0 flex-1" />
          <InputGroup className="w-56 min-w-0 shrink [-webkit-app-region:no-drag] **:[input]:h-8 sm:**:[input]:h-7">
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  listRef.current?.querySelector<HTMLElement>("[data-skill-key]")?.focus();
                }
              }}
              placeholder="Search skills"
              aria-label="Search skills"
            />
          </InputGroup>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  onClick={refresh}
                  aria-label={view.kind === "project" ? "Rescan project" : "Refresh skills"}
                  aria-busy={refreshing || scanning}
                  disabled={refreshing || scanning || environments.length === 0}
                  size="icon-sm"
                  variant="ghost"
                  className="[-webkit-app-region:no-drag]"
                >
                  <RefreshIcon size="sm" refreshing={refreshing || scanning} />
                </Button>
              }
            />
            <TooltipPopup side="bottom">
              {view.kind === "project" ? "Rescan project" : "Refresh skills"}
            </TooltipPopup>
          </Tooltip>
          {createTargets.length > 0 ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button size="sm" className="shrink-0 [-webkit-app-region:no-drag]">
                    <PlusIcon />
                    New skill
                    <ChevronDownIcon />
                  </Button>
                }
              />
              <MenuPopup align="end">
                <MenuItem onClick={() => setCreateOpen(true)}>
                  <PencilLineIcon />
                  Write it yourself
                </MenuItem>
                <MenuItem onClick={createWithAi}>
                  <MessageSquarePlusIcon />
                  Create with an agent
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
        </WorkspacePageHeader>
        {createEnvironment && createOpen ? (
          <SkillCreateDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            environmentId={createEnvironment.environmentId}
            targets={createTargets}
            initialProjectRoot={createProjectRoot}
            onCreate={async (request) => {
              const created = await actions.create({
                environmentId: createEnvironment.environmentId,
                input: {
                  name: request.name,
                  description: request.description,
                  instructions: request.instructions,
                  instanceIds: request.instanceIds,
                  ...(request.projectRoot ? { projectRoot: request.projectRoot } : {}),
                },
              });
              if (!created) return false;
              setQuery("");
              setSelectedKey(
                `${createEnvironment.environmentId}\u0000${request.instanceIds[0]}\u0000${created.path}`,
              );
              return true;
            }}
          />
        ) : null}
        <div className="flex min-h-0 flex-1 border-t border-border/60">{body}</div>
      </div>
    </SidebarInset>
  );
}

function SkillGroupList(props: {
  label: string;
  entries: ReadonlyArray<SkillEntry>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const first = props.entries[0];
  return (
    <section aria-label={props.label} className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 px-2 pb-1 text-xs font-semibold text-muted-foreground">
        {first ? (
          <ProviderInstanceIcon
            driverKind={first.driver}
            displayName={first.providerName}
            accentColor={first.accentColor}
            className="size-3.5"
            iconClassName="size-3.5"
            showBadge={false}
          />
        ) : null}
        <span className="truncate">{props.label}</span>
        <span className="ms-auto font-normal tabular-nums">{props.entries.length}</span>
      </div>
      {props.entries.map((entry) => (
        <SkillRow
          key={entry.key}
          entry={entry}
          selected={entry.key === props.selectedKey}
          onSelect={() => props.onSelect(entry.key)}
        />
      ))}
    </section>
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
      onFocus={props.onSelect}
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
        // Personal build: the list sits on the white panel, where the sidebar's
        // white row colors don't show; a gray wash marks hover and selection.
        "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        props.selected && "bg-accent hover:bg-accent",
        !entry.skill.enabled && "opacity-60",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{entry.displayName}</span>
        {entry.skill.enabled ? null : (
          <Badge variant="outline" size="sm" className="shrink-0">
            Disabled
          </Badge>
        )}
        {entry.source === "project" || entry.source === "plugin" ? (
          <span className="ms-auto shrink-0 text-2xs text-muted-foreground">
            {SOURCE_LABEL[entry.source]}
          </span>
        ) : null}
      </span>
      {summary ? (
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{summary}</span>
      ) : null}
    </button>
  );
}

function SkillDetail(props: {
  entry: SkillEntry;
  entries: ReadonlyArray<SkillEntry>;
  actions: ReturnType<typeof useSkillActions>;
  onBack: (() => void) | undefined;
}) {
  const { entry, actions } = props;
  const environment = useSkillsEnvironments().find(
    (candidate) => candidate.environmentId === entry.environmentId,
  );
  const { environments } = useEnvironments();
  const serverConfig =
    environments.find((candidate) => candidate.environmentId === entry.environmentId)
      ?.serverConfig ?? null;
  const availableEditors = serverConfig?.availableEditors ?? [];
  const openInPreferredEditor = useOpenInPreferredEditor(entry.environmentId, availableEditors);
  const fileMenu = useFileContextMenu(entry.environmentId);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const directory = skillDirectory(entry.skill.path);
  const file = useProjectFileQuery(entry.environmentId, directory, entry.skill.path);
  const body = file.data ? stripSkillFrontmatter(file.data.contents) : null;
  const invocation = skillInvocationLabel(entry.skill);
  const canOpen = availableEditors.some((editor) => editor !== "file-manager");
  const canManageSkills = useEnvironmentScope(entry.environmentId, AuthProvidersManageScope);
  // Plugin and built-in skills belong to their package, which would undo edits.
  const editable = canManageSkills && (entry.source === "personal" || entry.source === "project");
  const manageable = canManageSkills && isSkillManageable(entry.driver);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "toggle" | "share" | "delete" | null>(null);

  // Every provider on this machine that loads a skill of this name, and the
  // manageable ones that could load it too.
  const loadedBy = props.entries.filter(
    (candidate) =>
      candidate.environmentId === entry.environmentId && candidate.skill.name === entry.skill.name,
  );
  const shareTargets = (environment?.providers ?? []).filter(
    (provider) =>
      provider.enabled &&
      isSkillManageable(provider.driver) &&
      !loadedBy.some((candidate) => candidate.instanceId === provider.instanceId),
  );

  const openInEditor = async () => {
    const result = await openInPreferredEditor(entry.skill.path);
    if (result._tag !== "Failure") return;
    toastManager.add({
      type: "error",
      title: "Could not open skill",
      description: entry.skill.path,
    });
  };
  const fileTarget = {
    environmentId: entry.environmentId,
    filePath: entry.skill.path,
    workspaceRoot: undefined,
  };
  const save = async () => {
    if (draft === null || busy) return;
    setBusy("save");
    const saved = await actions.save({
      environmentId: entry.environmentId,
      input: { path: entry.skill.path, contents: draft },
    });
    setBusy(null);
    if (!saved) return;
    file.refresh();
    setDraft(null);
  };
  const toggle = async (enabled: boolean) => {
    setBusy("toggle");
    await actions.setEnabled({
      environmentId: entry.environmentId,
      input: {
        instanceId: entry.instanceId,
        path: entry.skill.path,
        name: entry.skill.name,
        enabled,
      },
    });
    setBusy(null);
  };
  const shareWith = async (instanceId: (typeof shareTargets)[number]["instanceId"]) => {
    setBusy("share");
    await actions.share({
      environmentId: entry.environmentId,
      input: {
        path: entry.skill.path,
        instanceId,
        ...(entry.projectCwd ? { projectRoot: entry.projectCwd } : {}),
      },
    });
    setBusy(null);
  };
  const remove = async () => {
    setBusy("delete");
    await actions.remove({
      environmentId: entry.environmentId,
      path: entry.skill.path,
      displayName: entry.displayName,
    });
    setBusy(null);
  };

  return (
    <ScrollArea className="h-full" scrollFade>
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 pt-6 pb-12">
        {props.onBack ? (
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={props.onBack}
            className="self-start @3xl/skills:hidden"
          >
            ← All skills
          </Button>
        ) : null}
        <header className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card">
              <ProviderInstanceIcon
                driverKind={entry.driver}
                displayName={entry.providerName}
                accentColor={entry.accentColor}
                showBadge={false}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="truncate text-xl font-semibold leading-tight text-foreground">
                {entry.displayName}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground/80">
                  /{entry.skill.name}
                </code>
                <span>{entry.providerName}</span>
                <span aria-hidden>·</span>
                <span>{SOURCE_LABEL[entry.source]}</span>
              </div>
            </div>
            {manageable ? (
              <label className="mt-1 flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                {entry.skill.enabled ? "Enabled" : "Disabled"}
                <Switch
                  checked={entry.skill.enabled}
                  disabled={busy !== null}
                  onCheckedChange={(checked) => void toggle(checked)}
                />
              </label>
            ) : null}
          </div>
          {entry.skill.description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {entry.skill.description}
            </p>
          ) : null}
          {entry.skill.enabled && invocation === null ? null : (
            <div className="flex flex-wrap gap-1.5">
              {entry.skill.enabled ? null : <Badge variant="warning">Disabled</Badge>}
              {invocation ? <Badge variant="secondary">{invocation}</Badge> : null}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Available in</span>
            {loadedBy.map((candidate) => (
              <span
                key={candidate.key}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-foreground/80"
              >
                <ProviderInstanceIcon
                  driverKind={candidate.driver}
                  displayName={candidate.providerName}
                  accentColor={candidate.accentColor}
                  className="size-3"
                  iconClassName="size-3"
                  showBadge={false}
                />
                {candidate.providerName}
              </span>
            ))}
            {editable
              ? shareTargets.map((provider) => (
                  <Button
                    key={provider.instanceId}
                    variant="ghost-muted"
                    size="micro"
                    disabled={busy !== null}
                    onClick={() => void shareWith(provider.instanceId)}
                  >
                    <PlusIcon />
                    Add to {resolveProviderInstanceDisplayName(provider)}
                  </Button>
                ))
              : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable ? (
              <Button
                variant="outline"
                size="sm"
                disabled={draft !== null || file.data === null}
                onClick={() => setDraft(file.data?.contents ?? "")}
              >
                <PencilLineIcon />
                Edit
              </Button>
            ) : null}
            {editable ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void actions.startChat(
                    entry.environmentId,
                    buildEditSkillPrompt(entry.skill.path),
                    entry.projectCwd ?? undefined,
                  )
                }
              >
                <MessageSquarePlusIcon />
                Edit with an agent
              </Button>
            ) : null}
            {canOpen ? (
              <Button variant="ghost" size="sm" onClick={() => void openInEditor()}>
                <SquarePenIcon />
                Open in editor
              </Button>
            ) : null}
            <div className="flex-1" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy path"
                    onClick={() => copyToClipboard(entry.skill.path)}
                  >
                    {isCopied ? <CheckIcon /> : <CopyIcon />}
                  </Button>
                }
              />
              <TooltipPopup side="bottom">{isCopied ? "Copied" : "Copy path"}</TooltipPopup>
            </Tooltip>
            <Menu>
              <MenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="More actions">
                    <EllipsisIcon />
                  </Button>
                }
              />
              <MenuPopup align="end">
                {fileMenu.capabilities.revealLabel ? (
                  <MenuItem onClick={() => void fileMenu.activate("reveal-in-folder", fileTarget)}>
                    <FolderOpenIcon />
                    {fileMenu.capabilities.revealLabel}
                  </MenuItem>
                ) : null}
                {editable ? (
                  <MenuItem variant="destructive" onClick={() => void remove()}>
                    <Trash2Icon />
                    Delete skill
                  </MenuItem>
                ) : null}
              </MenuPopup>
            </Menu>
          </div>
          <StartTruncatedPath
            path={entry.skill.path}
            className="font-mono text-2xs text-muted-foreground"
          />
        </header>
        {draft !== null ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void save();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(null);
                }
              }}
              aria-label="SKILL.md"
              rows={24}
              autoFocus
              variant="code"
            />
            <div className="flex items-center justify-end gap-2">
              <span className="me-auto text-xs text-muted-foreground">
                {loadedBy.length > 1
                  ? "Saving updates every provider that loads this skill."
                  : `${isMacPlatform(navigator.platform) ? "⌘S" : "Ctrl+S"} to save, Esc to cancel.`}
              </span>
              <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy === "save" || draft === file.data?.contents}
                onClick={() => void save()}
              >
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 bg-card/40">
            {body !== null ? (
              body.length > 0 ? (
                <>
                  <ChatMarkdown
                    text={body}
                    cwd={directory}
                    imageBaseDir={directory}
                    environmentId={entry.environmentId}
                    headingLevelOffset={2}
                    className="px-6 py-5"
                  />
                  {file.data?.truncated ? (
                    <p className="border-t border-border/60 px-6 py-3 text-xs text-muted-foreground">
                      This SKILL.md is long, so only the start is shown. Open it in your editor to
                      read the rest.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="px-6 py-5 text-sm text-muted-foreground">
                  This SKILL.md has no instructions after its header.
                </p>
              )
            ) : file.error ? (
              <p className="px-6 py-5 text-sm text-muted-foreground">
                Could not read this skill’s SKILL.md: {file.error}
              </p>
            ) : (
              <div className="flex flex-col gap-3 px-6 py-5">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}
          </div>
        )}
      </article>
    </ScrollArea>
  );
}

function SkillsListSkeleton() {
  return (
    <div className="flex w-full flex-col gap-2 p-4 @3xl/skills:w-80">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5 rounded-lg px-2.5 py-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}

function SkillsEmptyState(props: { title: string; description: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SkillsIcon />
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
