// Personal build: the pieces of the thread list's look that upstream does not
// have: calm two-line rows with the chat's avatar, the group titles, the
// contact-card hover card, and the row's hover actions. Sidebar.tsx keeps
// upstream's row logic and renders these.
import type { EnvironmentMachineKind } from "@t3tools/contracts";
import {
  AlarmClockOffIcon,
  ArrowRightLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  GitBranchIcon,
  MailIcon,
  MailOpenIcon,
  PinOffIcon,
  TerminalIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { usePinIcon } from "../../pinIcons";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { SidebarThreadSummary } from "../../types";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { liveWorkLine } from "../liveWorkLine";
import { sidebarMessagePreview } from "../messagePreview";
import { PIN_ICON_COLORS, pinLineIcon } from "../pinLineIcons";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";
import {
  ThreadPullRequestsMiniList,
  type TerminalStatusIndicator,
} from "../ThreadStatusIndicators";
import { MiddleTruncate } from "../ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type ProviderBadgeEntry = Pick<
  ProviderInstanceEntry,
  "driverKind" | "displayName" | "accentColor" | "acpRegistryAgentId" | "acpRegistryIconUrl"
>;

// Flat, Arc-like surfaces. List rows have no fill at rest and the open row is
// solid. Unsent work reads as a "Draft" label on the row's second line rather
// than a tint, which looked like a selection.
export const restSurfaceClassName = "bg-transparent hover:bg-sidebar-row-hover";
export const activeSurfaceClassName = "bg-sidebar-row-active";
export const selectedSurfaceClassName = "bg-sidebar-row-selected";

/** The model's provider logo on the corner of a chat's avatar. */
function ChatAvatarModelBadge(props: {
  providerEntry: ProviderBadgeEntry | null;
  instanceId: string;
}) {
  const driverKind = props.providerEntry?.driverKind ?? null;
  if (driverKind === null) return null;
  return (
    <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-popover shadow-xs">
      <ProviderInstanceIcon
        driverKind={driverKind}
        displayName={props.providerEntry?.displayName ?? props.instanceId}
        accentColor={props.providerEntry?.accentColor}
        acpRegistryAgentId={props.providerEntry?.acpRegistryAgentId}
        acpRegistryIconUrl={props.providerEntry?.acpRegistryIconUrl}
        showBadge={false}
        iconClassName="size-3"
      />
    </span>
  );
}

/** A chat's avatar: its own icon (right-click, Change icon…), else its
    project's, with the model's provider logo on the corner. Shared by the row,
    the draft row, and the hover card. */
export function ThreadAvatar(props: {
  /** Null for a draft, which has no icon of its own yet. */
  threadKey: string | null;
  project: ProjectFaviconProject | null;
  providerEntry: ProviderBadgeEntry | null;
  modelInstanceId: string | null;
}) {
  const pinEmoji = usePinIcon(props.threadKey ?? "");
  const chosen = props.threadKey === null ? null : pinEmoji;
  const pinLine = chosen === null ? null : pinLineIcon(chosen);
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center">
      {/* A chosen icon sits in its own rounded square, like a project's icon,
          so it reads as the chat's avatar. */}
      {pinLine !== null ? (
        <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-control-surface">
          <pinLine.Icon
            aria-hidden
            className={cn(
              "size-4",
              pinLine.color === null ? "text-sidebar-foreground" : PIN_ICON_COLORS[pinLine.color],
            )}
          />
        </span>
      ) : chosen !== null ? (
        <span
          aria-hidden
          className="flex size-7 items-center justify-center rounded-md bg-sidebar-control-surface text-base leading-none"
        >
          {chosen}
        </span>
      ) : props.project ? (
        <ProjectFavicon project={props.project} className="size-7 rounded-md" />
      ) : null}
      {props.modelInstanceId !== null ? (
        <ChatAvatarModelBadge
          providerEntry={props.providerEntry}
          instanceId={props.modelInstanceId}
        />
      ) : null}
    </span>
  );
}

/** One title style for every group (New threads, Unread, Pinned, Open,
    Working, Snoozed, Settled). Clicking it collapses or expands the group. */
export function SidebarGroupButton(props: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  /** The lifted row would land in this group. */
  isDropTarget?: boolean | undefined;
  /** The count reads as a badge: these chats are waiting on you. */
  emphasis?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      onClick={props.onToggle}
      aria-expanded={props.expanded}
      className={cn(
        "group/label flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 text-left text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        props.isDropTarget
          ? "text-primary"
          : "text-sidebar-muted-foreground hover:text-sidebar-foreground",
      )}
    >
      {props.label}
      {props.emphasis ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold text-primary-foreground tabular-nums">
          {props.count}
        </span>
      ) : (
        <span className="font-medium text-sidebar-muted-foreground/60 tabular-nums">
          {props.count}
        </span>
      )}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "ml-auto size-3.5 opacity-0 transition group-hover/label:opacity-100 group-focus-visible/label:opacity-100",
          !props.expanded && "-rotate-90 opacity-100",
        )}
      />
    </button>
  );
}

/** The hover card, shaped like a messages app's contact card: the chat's
    avatar, title, and project, then its latest reply (or, while it works,
    what it's doing), then the details. Pull requests live here, not on the
    row. */
export function SidebarThreadCardBody(props: {
  thread: SidebarThreadSummary;
  avatar: ReactNode;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntry: ProviderBadgeEntry | null;
  showInstanceBadge: boolean;
  modelInstanceId: string;
  modelLabel: string;
  previousProviderNames: readonly string[];
  branchMismatch: { threadBranch: string; currentBranch: string } | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalProcessLabel: string;
  showPullRequests: boolean;
}) {
  const { thread, providerEntry } = props;
  const driverKind = providerEntry?.driverKind ?? null;
  const latestReply =
    resolveSidebarThreadStatus(thread) === "working"
      ? liveWorkLine(thread) || null
      : sidebarMessagePreview(thread.latestVisibleMessage?.text);
  return (
    <div className="flex w-72 min-w-0 flex-col gap-2.5 px-1 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {props.avatar}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-tight font-semibold text-foreground">
            {thread.title}
          </div>
          {props.projectDisplayName ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {props.projectDisplayName}
            </div>
          ) : null}
        </div>
      </div>
      {latestReply ? (
        <p className="line-clamp-3 text-xs leading-relaxed text-foreground/80">{latestReply}</p>
      ) : null}
      <div className="grid gap-1.5 border-t border-border/60 pt-2 pl-0.5 text-xs text-muted-foreground">
        {props.environmentLabel ? (
          <div className="flex min-w-0 items-center gap-2">
            <EnvironmentMachineIcon
              kind={props.environmentMachine}
              className="size-3 shrink-0 stroke-muted-foreground"
            />
            <div className="min-w-0 truncate text-foreground/75">{props.environmentLabel}</div>
          </div>
        ) : null}
        {thread.branch ? (
          <div className="flex min-w-0 items-center gap-2 text-foreground/75">
            <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
            <MiddleTruncate value={thread.branch} className="flex" />
          </div>
        ) : null}
        {props.branchMismatch ? (
          <div className="flex min-w-0 items-start gap-2 text-warning">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
            <div className="min-w-0 flex-1 wrap-break-word">
              You're currently checked out on another branch.
            </div>
          </div>
        ) : null}
        {driverKind ? (
          <div className="flex min-w-0 items-center gap-2">
            <ProviderInstanceIcon
              driverKind={driverKind}
              displayName={
                providerEntry?.displayName ?? thread.runtime?.providerName ?? props.modelInstanceId
              }
              accentColor={providerEntry?.accentColor}
              acpRegistryAgentId={providerEntry?.acpRegistryAgentId}
              acpRegistryIconUrl={providerEntry?.acpRegistryIconUrl}
              showBadge={props.showInstanceBadge && providerEntry?.accentColor !== undefined}
              badgeContent="none"
              badgeClassName="h-2 min-w-2 px-0"
              iconClassName="size-3 shrink-0 grayscale opacity-60"
            />
            <div className="min-w-0 truncate text-foreground/75">
              {props.showInstanceBadge && providerEntry
                ? `${props.modelLabel} · ${providerEntry.displayName}`
                : props.modelLabel}
            </div>
          </div>
        ) : null}
        {props.previousProviderNames.length > 0 ? (
          <div className="flex min-w-0 items-center gap-2">
            <ArrowRightLeftIcon className="size-3 shrink-0 stroke-muted-foreground" />
            <div className="min-w-0 truncate text-foreground/75">
              Handed off from {props.previousProviderNames.join(", ")}
            </div>
          </div>
        ) : null}
        {props.terminalStatus ? (
          <div className="flex min-w-0 items-center gap-2">
            <TerminalIcon
              aria-hidden
              className={cn("size-3 shrink-0", props.terminalStatus.colorClass)}
            />
            <div className="min-w-0 truncate text-foreground/75">{props.terminalProcessLabel}</div>
          </div>
        ) : null}
        {thread.runtime?.lastError ? (
          <div
            className={cn(
              "flex min-w-0 items-center gap-2",
              thread.runtime.lastErrorClass === "usage_limit" ? "text-warning" : "text-error",
            )}
          >
            <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
            <div className="min-w-0 truncate">
              {thread.runtime.lastErrorClass === "usage_limit"
                ? "Usage limit reached"
                : "Error occurred"}
            </div>
          </div>
        ) : null}
      </div>
      {props.showPullRequests && thread.pullRequests.length > 0 ? (
        <div className="border-t border-border/60 pt-2 pl-0.5 text-xs text-muted-foreground">
          <ThreadPullRequestsMiniList pullRequests={thread.pullRequests} />
        </div>
      ) : null}
    </div>
  );
}

const hoverActionClassName =
  "inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground";
const hoverLabeledActionClassName =
  "-mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground";

type RowClick = (event: ReactMouseEvent) => void;

/** The row's hover actions. A pinned row unpins here (the Pinned title already
    says it is pinned) and offers no one-click settle or snooze; both stay in
    the context menu. Snoozed and settled rows offer only the way back out.
    Each button acts on its own row: upstream's drag-to-sweep is left out. */
export function ThreadRowHoverActions(props: {
  variantAction: "settle" | "unsettle" | "unsnooze";
  isPinnedRow: boolean;
  hasUnsentDraft: boolean;
  canToggleRead: boolean;
  showsAsUnread: boolean;
  snoozeSupported: boolean;
  settlementSupported: boolean;
  snoozeMenuOpen: boolean;
  snoozeButton: ReactNode;
  onUnpin: RowClick;
  onDiscardDraft: RowClick;
  onToggleRead: RowClick;
  onUnsnooze: RowClick;
  onUnsettle: RowClick;
  onSettle: RowClick;
}) {
  const readLabel = props.showsAsUnread ? "Mark as read" : "Mark as unread";
  return (
    <span
      className={cn(
        // focus-visible, not focus-within: a mouse click leaves the Settle
        // button focused, and a plain focus-within would keep the controls
        // pinned over the time once the pointer moves away (e.g. after a
        // failed settle) instead of cross-fading back.
        "pointer-events-none absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:static group-any-hover/sidebar-row:opacity-100",
        props.snoozeMenuOpen && "pointer-events-auto static opacity-100",
      )}
    >
      {props.isPinnedRow ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Unpin thread"
                onClick={props.onUnpin}
                className={hoverActionClassName}
              />
            }
          >
            <PinOffIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Unpin thread</TooltipPopup>
        </Tooltip>
      ) : null}
      {props.hasUnsentDraft ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Discard draft"
                onClick={props.onDiscardDraft}
                className={hoverActionClassName}
              />
            }
          >
            <XIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Discard draft</TooltipPopup>
        </Tooltip>
      ) : null}
      {props.canToggleRead ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={readLabel}
                onClick={props.onToggleRead}
                className={hoverActionClassName}
              />
            }
          >
            {props.showsAsUnread ? (
              <MailOpenIcon className="size-3.5" />
            ) : (
              <MailIcon className="size-3.5" />
            )}
          </TooltipTrigger>
          <TooltipPopup side="top">{readLabel}</TooltipPopup>
        </Tooltip>
      ) : null}
      {props.snoozeButton}
      {props.variantAction === "unsnooze" ? (
        props.snoozeSupported ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Wake thread now"
                  onClick={props.onUnsnooze}
                  className={hoverLabeledActionClassName}
                />
              }
            >
              <AlarmClockOffIcon className="size-3.5" />
              Wake
            </TooltipTrigger>
            <TooltipPopup>Wake thread now</TooltipPopup>
          </Tooltip>
        ) : null
      ) : props.variantAction === "unsettle" ? (
        props.settlementSupported ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Un-settle thread"
                  onClick={props.onUnsettle}
                  className={hoverLabeledActionClassName}
                />
              }
            >
              <Undo2Icon className="size-3.5" />
              Restore
            </TooltipTrigger>
            <TooltipPopup>Un-settle thread</TooltipPopup>
          </Tooltip>
        ) : null
      ) : props.settlementSupported && !props.isPinnedRow ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Settle thread"
                onClick={props.onSettle}
                className={hoverLabeledActionClassName}
              />
            }
          >
            <CheckIcon className="size-3.5" />
            Settle
          </TooltipTrigger>
          <TooltipPopup>Settle thread</TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** The row's second line: the status in its color ("Failed: …"), then the
    details in gray. Color is reserved for status. */
export function ThreadRowSecondLine(props: {
  status: { label: string; className: string } | null;
  details: string;
  trailing: ReactNode;
}) {
  return (
    <div className="flex h-4 min-w-0 items-center gap-1.5 text-xs text-sidebar-muted-foreground">
      <span className="min-w-0 flex-1 truncate">
        {props.status ? (
          <span className={cn("font-medium", props.status.className)}>{props.status.label}</span>
        ) : null}
        {props.status && props.details ? ": " : null}
        {props.details}
      </span>
      {props.trailing}
    </div>
  );
}

/** A new-thread draft, shaped like a thread row: "New thread in <project>",
    then the typed text as the draft. */
export function DraftRowBody(props: {
  project: ProjectFaviconProject | null;
  projectDisplayName: string | null;
  providerEntry: ProviderBadgeEntry | null;
  modelInstanceId: string | null;
  preview: string;
  onDiscard: RowClick;
}) {
  // Titled like a messages app's "New Message to …".
  const title = props.projectDisplayName
    ? `New thread in ${props.projectDisplayName}`
    : "New thread";
  return (
    <div className="relative z-10 flex h-12 items-center gap-2.5 px-(--sidebar-row-content-inset)">
      <ThreadAvatar
        threadKey={null}
        project={props.project}
        providerEntry={props.providerEntry}
        modelInstanceId={props.modelInstanceId}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex h-5 min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground/90"
          >
            {title}
          </span>
          <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Discard draft"
                    onClick={props.onDiscard}
                    className="pointer-events-none inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                }
              />
              <TooltipPopup side="top">Discard draft</TooltipPopup>
            </Tooltip>
          </span>
        </div>
        <div
          aria-hidden
          className="flex h-4 min-w-0 items-center text-xs text-sidebar-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-warning-foreground">Draft</span>
            {": "}
            {props.preview}
          </span>
        </div>
      </div>
    </div>
  );
}
