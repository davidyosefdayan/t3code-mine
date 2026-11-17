import type { EnvironmentId, PullRequestAction } from "@t3tools/contracts";
import { useMessages } from "gt-react";
import { useDeferredValue, useState, type ReactNode, type RefCallback } from "react";

import { cn } from "~/lib/utils";
import { SidebarListGroup } from "../page/SidebarListLayout";
import {
  pullRequestEntryKey,
  scorePullRequestMatch,
  type EnvironmentPullRequestEntry,
  type PullRequestGroup,
} from "./pullRequestList.logic";
import { PullRequestRow, type PullRequestRowTarget } from "./PullRequestRow";
import {
  PullRequestSpeedModeProvider,
  type PullRequestSpeedActionResult,
} from "./PullRequestSpeedActions";

const MATCHED_ELSEWHERE_SCORE = 10;
const FIRST_PAINT_ROWS = 24;

function firstPaintGroups<Group extends { entries: ReadonlyArray<unknown> }>(
  groups: ReadonlyArray<Group>,
): ReadonlyArray<Group> {
  let left = FIRST_PAINT_ROWS;
  return groups.flatMap((group) => {
    const entries = group.entries.slice(0, left);
    left -= entries.length;
    return entries.length === 0 ? [] : [{ ...group, entries }];
  });
}

export function PullRequestListGroups({
  groups,
  environmentLabels,
  query,
  selected,
  showProvider,
  statsRef,
  onSelect,
  onIntent,
  hostActionsOf,
  onActed,
  closingKeys,
  sweepingKeys,
  onCloseSweepStart,
}: {
  groups: ReadonlyArray<PullRequestGroup<EnvironmentPullRequestEntry>>;
  /** Only when rows come from more than one server, so each says which. */
  environmentLabels: ReadonlyMap<EnvironmentId, string> | null;
  query: string;
  selected: {
    readonly environmentId: string | undefined;
    readonly repository: string;
    readonly host: string | undefined;
    readonly number: number;
  } | null;
  showProvider: boolean;
  statsRef: RefCallback<HTMLDivElement>;
  onSelect: (entry: PullRequestRowTarget) => void;
  onIntent: (entry: PullRequestRowTarget | null) => void;
  hostActionsOf: (entry: EnvironmentPullRequestEntry) => ReadonlySet<PullRequestAction>;
  onActed: (result: PullRequestSpeedActionResult) => void;
  closingKeys: ReadonlySet<string>;
  sweepingKeys: ReadonlySet<string>;
  onCloseSweepStart: (entry: EnvironmentPullRequestEntry, event: PointerEvent) => void;
}) {
  // Every row mounts tooltips and actions; painting a first screenful before the rest keeps
  // opening the page from blocking on the whole list.
  const shownGroups = useDeferredValue(groups, firstPaintGroups(groups));
  const resolve = useMessages();
  const counts = new Map(groups.map((group) => [group.key, group.entries.length]));
  // Personal build: group titles are the thread list's, and fold their group the same way.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (!next.delete(key)) next.add(key);
    setCollapsed(next);
  };
  return (
    <PullRequestSpeedModeProvider>
      <div className={cn(sweepingKeys.size > 0 && "**:pointer-events-none")}>
        {shownGroups.map((group) => {
          const rows: ReactNode = group.entries.map((entry) => {
            const entryKey = pullRequestEntryKey(entry);
            const environmentLabel = environmentLabels?.get(entry.environmentId);
            return (
              <PullRequestRow
                key={entryKey}
                statsKey={entryKey}
                statsRef={statsRef}
                entry={entry}
                showProjectTitle
                showProvider={showProvider}
                {...(environmentLabel !== undefined ? { environmentLabel } : {})}
                matchedElsewhere={
                  query.length > 0 && scorePullRequestMatch(entry, query) <= MATCHED_ELSEWHERE_SCORE
                }
                selected={
                  selected?.environmentId === entry.environmentId &&
                  selected.repository === entry.repository &&
                  selected.host?.toLowerCase() === entry.host.toLowerCase() &&
                  selected.number === entry.number
                }
                onSelect={onSelect}
                onIntent={onIntent}
                hostActions={hostActionsOf(entry)}
                onActed={onActed}
                closing={closingKeys.has(entryKey)}
                sweeping={sweepingKeys.has(entryKey)}
                onCloseSweepStart={onCloseSweepStart}
              />
            );
          });
          return group.label ? (
            <SidebarListGroup
              key={group.key}
              label={resolve(group.label)}
              count={counts.get(group.key) ?? group.entries.length}
              expanded={!collapsed.has(group.key)}
              onToggle={() => toggle(group.key)}
            >
              {rows}
            </SidebarListGroup>
          ) : (
            <div key={group.key} className="flex flex-col gap-0.5 pt-3">
              {rows}
            </div>
          );
        })}
      </div>
    </PullRequestSpeedModeProvider>
  );
}
