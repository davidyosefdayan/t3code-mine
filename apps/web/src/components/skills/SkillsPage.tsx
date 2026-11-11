import { AuthProvidersManageScope } from "@t3tools/contracts";
import {
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  FolderOpenIcon,
  MessageSquarePlusIcon,
  PencilLineIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useOpenInPreferredEditor } from "../../editorPreferences";
import { useFileContextMenu } from "../../fileContextMenu";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { isMacPlatform } from "../../lib/utils";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { useEnvironmentScope } from "../../state/session";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { StartTruncatedPath } from "../StartTruncatedPath";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
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
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { PageCard, PageMessage, PageSection } from "../page/PageSection";
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
  skillDirectory,
  skillInvocationLabel,
  stripSkillFrontmatter,
  type SkillEntry,
  type SkillSource,
  type SkillsEnvironmentInput,
  type SkillsView,
} from "./skillsCatalog";

export const SOURCE_LABEL: Record<SkillSource, string> = {
  personal: "Personal",
  project: "Project",
  plugin: "Plugin",
  system: "Built in",
};

/** Connected environments' providers, the input every skills view starts from. */
export function useSkillsEnvironments(): SkillsEnvironmentInput[] {
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  return environments.flatMap((environment) =>
    environment.connection.phase === "connected" && environment.serverConfig
      ? [
          {
            environmentId: environment.environmentId,
            label: environment.label,
            providers: providersByEnvironment.get(environment.environmentId) ?? [],
          },
        ]
      : [],
  );
}

/**
 * Personal build: New skill, which lives in the Skills sidebar beside search
 * like New thread. Returns the targets, the two ways to start, and the dialog.
 */
export function useSkillCreation(
  view: SkillsView,
  environments: ReadonlyArray<SkillsEnvironmentInput>,
  entries: ReadonlyArray<SkillEntry>,
  onCreated: (key: string) => void,
) {
  const actions = useSkillActions();
  const [createOpen, setCreateOpen] = useState(false);
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

  const dialog =
    createEnvironment && createOpen ? (
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
          onCreated(
            `${createEnvironment.environmentId}\u0000${request.instanceIds[0]}\u0000${created.path}`,
          );
          return true;
        }}
      />
    ) : null;
  return {
    canCreate: createTargets.length > 0,
    openWrite: () => setCreateOpen(true),
    createWithAi,
    dialog,
  };
}

export function SkillsPage({
  view,
  selectedKey,
}: {
  view: SkillsView;
  /** The skill from the URL; absent shows the first in the view. */
  selectedKey: string | null;
}) {
  const environments = useSkillsEnvironments();
  const projects = useProjects();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  // The project whose opening scan finished, so a scan that fails stops spinning.
  const [scannedProject, setScannedProject] = useState<string | null>(null);
  const actions = useSkillActions();

  const entries = collectSkillEntries(environments);
  const viewEntries = filterSkillEntriesForView(entries, view);
  // Same order as the sidebar's list, so the default pick is its first row.
  const ordered = groupSkillEntries(viewEntries).flatMap((group) => group.entries);
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

  // A project's skills only exist once its providers have scanned the folder,
  // which the composer otherwise does on first use. Opening the project here
  // scans it, and Refresh rescans.
  const projectKey = view.kind === "project" ? `${view.environmentId}:${view.cwd}` : null;
  const projectProviders =
    view.kind === "project"
      ? (environments.find((entry) => entry.environmentId === view.environmentId)?.providers ?? [])
      : [];
  const unscannedProviders = projectProviders.filter(
    (provider) =>
      provider.enabled &&
      view.kind === "project" &&
      !provider.workspaceSnapshots?.some((snapshot) => snapshot.cwd === view.cwd),
  );
  const scanProject = async (fresh: boolean) => {
    if (view.kind !== "project") return;
    const pending = fresh
      ? projectProviders.filter((provider) => provider.enabled)
      : unscannedProviders;
    if (pending.length === 0) return;
    const key = projectKey;
    const { environmentId, cwd } = view;
    // A fresh scan drops every other provider's scan of the project, so
    // only the first is fresh and the rest refill after it, one at a time.
    const scanAll = async () => {
      for (const [index, provider] of pending.entries()) {
        await refreshProviders({
          environmentId,
          input: {
            instanceId: provider.instanceId,
            cwd,
            ...(fresh && index === 0 ? { fresh } : {}),
          },
        });
      }
    };
    await scanAll().finally(() => setScannedProject(key));
  };
  const scanProjectOnOpen = useEffectEvent(() => void scanProject(false));
  const environmentConnected =
    view.kind === "project" &&
    environments.some((environment) => environment.environmentId === view.environmentId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the project's server to rescan its skills when the project page opens or reconnects
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

  const scanning =
    projectKey !== null && scannedProject !== projectKey && unscannedProviders.length > 0;
  const body: ReactNode =
    environments.length === 0 ? (
      <SkillsEmptyState
        title="No computer connected"
        description="Skills come from the agents on a connected computer."
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
              : "Skills your agents can use show up here, from your skill folders, projects, and plugins."
          }
        />
      )
    ) : null;

  const breadcrumb = (
    <WorkspaceBreadcrumb ariaLabel="Skills breadcrumb" className="min-w-0">
      <WorkspaceBreadcrumbItem current={view.kind === "all" && selected === null}>
        <h1>Skills</h1>
      </WorkspaceBreadcrumbItem>
      {view.kind === "all" ? null : (
        <>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current={selected === null} className="min-w-0">
            <span className="truncate">{viewLabel}</span>
          </WorkspaceBreadcrumbItem>
        </>
      )}
      {selected ? (
        <>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current className="min-w-0">
            <span className="truncate">{selected.displayName}</span>
          </WorkspaceBreadcrumbItem>
        </>
      ) : null}
    </WorkspaceBreadcrumb>
  );
  const refreshButton = (
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
          >
            <RefreshIcon size="sm" refreshing={refreshing || scanning} />
          </Button>
        }
      />
      <TooltipPopup side="bottom">
        {view.kind === "project" ? "Rescan project" : "Refresh skills"}
      </TooltipPopup>
    </Tooltip>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {selected && environments.length > 0 && viewEntries.length > 0 ? (
          <SkillDetail
            key={selected.key}
            entry={selected}
            entries={entries}
            actions={actions}
            breadcrumb={breadcrumb}
            pageActions={refreshButton}
          />
        ) : (
          <>
            <SkillsPageHeader breadcrumb={breadcrumb}>{refreshButton}</SkillsPageHeader>
            <div className="flex min-h-0 flex-1">{body}</div>
          </>
        )}
      </div>
    </SidebarInset>
  );
}

/** The title bar: where you are, then small actions for what's on screen. */
function SkillsPageHeader(props: { breadcrumb: ReactNode; children: ReactNode }) {
  return (
    // Right edge on the titlebar-controls inset, like Usage, so the actions
    // line up with the panel toggle on the thread pages.
    <WorkspacePageHeader electron={isElectron} className="pr-(--workspace-controls-right)">
      {props.breadcrumb}
      <div className="ms-auto flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        {props.children}
      </div>
    </WorkspacePageHeader>
  );
}

function SkillDetail(props: {
  entry: SkillEntry;
  entries: ReadonlyArray<SkillEntry>;
  actions: ReturnType<typeof useSkillActions>;
  breadcrumb: ReactNode;
  pageActions: ReactNode;
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

  const editing = draft !== null;
  const saveHint =
    loadedBy.length > 1
      ? "Saving updates every agent that loads this skill."
      : `${isMacPlatform(navigator.platform) ? "⌘S" : "Ctrl+S"} to save, Esc to cancel.`;

  // Personal build: the skill's own actions sit in the title bar beside its
  // name, like a chat's; the body is drawn with the page pieces, like Usage.
  return (
    <>
      <SkillsPageHeader breadcrumb={props.breadcrumb}>
        {props.pageActions}
        {manageable ? (
          <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
            {entry.skill.enabled ? "On" : "Off"}
            <Switch
              checked={entry.skill.enabled}
              disabled={busy !== null}
              onCheckedChange={(checked) => void toggle(checked)}
              aria-label="Skill on"
            />
          </label>
        ) : null}
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <EllipsisIcon />
              </Button>
            }
          />
          <MenuPopup align="end">
            {canOpen ? (
              <MenuItem onClick={() => void openInEditor()}>
                <SquarePenIcon />
                Open in editor
              </MenuItem>
            ) : null}
            {fileMenu.capabilities.revealLabel ? (
              <MenuItem onClick={() => void fileMenu.activate("reveal-in-folder", fileTarget)}>
                <FolderOpenIcon />
                {fileMenu.capabilities.revealLabel}
              </MenuItem>
            ) : null}
            <MenuItem onClick={() => copyToClipboard(entry.skill.path)}>
              {isCopied ? <CheckIcon /> : <CopyIcon />}
              Copy path
            </MenuItem>
            {editable ? (
              <MenuItem variant="destructive" onClick={() => void remove()}>
                <Trash2Icon />
                Delete skill
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      </SkillsPageHeader>
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <WorkspacePageContainer className="mx-0 max-w-none">
          {entry.skill.description ? (
            <p className="max-w-3xl px-3 text-sm text-muted-foreground sm:px-4">
              {entry.skill.description}
            </p>
          ) : null}

          <PageCard>
            <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-sm">
              <dt className="text-xs text-muted-foreground">Command</dt>
              <dd>
                <code className="font-mono text-foreground">/{entry.skill.name}</code>
                {invocation ? (
                  <span className="ms-2 text-xs text-muted-foreground">{invocation}</span>
                ) : null}
              </dd>
              <dt className="text-xs text-muted-foreground">Available in</dt>
              <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {loadedBy.map((candidate) => (
                  <span key={candidate.key} className="inline-flex items-center gap-1.5">
                    <ProviderInstanceIcon
                      driverKind={candidate.driver}
                      displayName={candidate.providerName}
                      accentColor={candidate.accentColor}
                      className="size-3.5"
                      iconClassName="size-3.5"
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
              </dd>
              <dt className="text-xs text-muted-foreground">Source</dt>
              <dd className="text-foreground">{SOURCE_LABEL[entry.source]}</dd>
              <dt className="text-xs text-muted-foreground">File</dt>
              <dd className="min-w-0">
                <StartTruncatedPath
                  path={entry.skill.path}
                  className="block font-mono text-xs text-muted-foreground"
                />
              </dd>
            </dl>
          </PageCard>

          <PageSection
            title="Instructions"
            action={
              editable && !editing ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={file.data === null}
                    onClick={() => setDraft(file.data?.contents ?? "")}
                  >
                    <PencilLineIcon />
                    Edit
                  </Button>
                </div>
              ) : null
            }
          >
            {editing ? (
              <PageCard
                footer={
                  <div className="flex items-center justify-end gap-2">
                    <span className="me-auto">{saveHint}</span>
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
                }
              >
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
              </PageCard>
            ) : body !== null ? (
              body.length > 0 ? (
                <PageCard
                  footer={
                    file.data?.truncated ? (
                      <p>
                        This SKILL.md is long, so only the start is shown. Open it in your editor to
                        read the rest.
                      </p>
                    ) : undefined
                  }
                >
                  <ChatMarkdown
                    text={body}
                    cwd={directory}
                    imageBaseDir={directory}
                    environmentId={entry.environmentId}
                    headingLevelOffset={2}
                    className="max-w-3xl"
                  />
                </PageCard>
              ) : (
                <PageMessage>This SKILL.md has no instructions after its header.</PageMessage>
              )
            ) : file.error ? (
              <PageMessage>Could not read this skill’s SKILL.md: {file.error}</PageMessage>
            ) : (
              <PageCard>
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </PageCard>
            )}
          </PageSection>
        </WorkspacePageContainer>
      </ScrollArea>
    </>
  );
}

function SkillsListSkeleton() {
  return (
    <div className="min-h-0 min-w-0 flex-1" aria-busy>
      <WorkspacePageContainer className="mx-0 max-w-none">
        <div className="flex flex-col gap-2 px-3 sm:px-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton shape="card" className="h-36" />
        <Skeleton shape="card" className="h-64" />
      </WorkspacePageContainer>
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
