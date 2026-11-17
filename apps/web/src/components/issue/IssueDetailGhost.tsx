import type { IssueListEntry } from "@t3tools/contracts";
import { T, useGT, useMessages, Var } from "gt-react";
import { ExternalLinkIcon, TagIcon, UsersIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Button } from "../ui/button";
import { PullRequestDetailTitleRow } from "../pullRequest/PullRequestDetailLayout";
import { GhostBar } from "../pullRequest/PullRequestGhosts";
import { PullRequestMetaRow } from "../pullRequest/PullRequestSummaryTab";
import {
  PullRequestActorLabel,
  PullRequestLabelChip,
  PullRequestMetaLine,
} from "../pullRequest/pullRequestPresentation";
import { PAGE_READING_COLUMN, PAGE_SCROLLER } from "../page/Page";
import { IssueStateGlyph, issueTrackerPresentation } from "./issuePresentation";

/** The issue panel while its detail loads, showing what the list row already knows. */
export function IssueDetailGhost({ seed }: { seed?: IssueListEntry | null }) {
  const gt = useGT();
  const messages = useMessages();
  const tracker = seed ? issueTrackerPresentation(seed.tracker) : null;
  return (
    <div
      role="status"
      aria-label={gt("Loading issue")}
      className={cn(
        "scrollbar-gutter-both flex h-full min-h-0 flex-col overflow-hidden px-4 pb-4",
        !seed && "motion-safe:animate-skeleton",
      )}
    >
      {seed && tracker ? (
        <>
          {/* Personal build: rows and gaps match the loaded panel, so nothing moves when it lands. */}
          <PullRequestDetailTitleRow className="h-7 gap-2">
            <IssueStateGlyph state={seed.state} />
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {seed.displayKey}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              <tracker.Icon aria-hidden className="mr-1 inline size-3 align-[-2px]" />
              {seed.scope}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Open on {provider}", { provider: tracker.providerName })}
              render={<a href={seed.url} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLinkIcon aria-hidden className="size-3.5" />
            </Button>
          </PullRequestDetailTitleRow>
          {/* Leaves room for the edit button, so the title wraps the same once loaded. */}
          <PullRequestDetailTitleRow className="mt-1 gap-1">
            <h2 className="min-w-0 flex-1 pr-7 text-base font-semibold leading-snug">
              {seed.title}
            </h2>
          </PullRequestDetailTitleRow>
          <PullRequestMetaLine className="mt-2 min-h-5 text-xs text-muted-foreground">
            <PullRequestActorLabel actor={seed.author} />
            <span>
              <T>
                opened <Var>{formatRelativeTimeLabel(seed.createdAt, undefined, messages)}</Var>
              </T>
            </span>
            {seed.closedAt ? (
              <span>
                <T>
                  closed <Var>{formatRelativeTimeLabel(seed.closedAt, undefined, messages)}</Var>
                </T>
              </span>
            ) : null}
          </PullRequestMetaLine>
          <div className="mt-4 space-y-2">
            <PullRequestMetaRow icon={<TagIcon className="size-3.5" />} label={gt("Labels")}>
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {seed.labels.length === 0 ? (
                  <span className="text-muted-foreground">
                    <T context="no labels">None</T>
                  </span>
                ) : (
                  seed.labels.map((label) => (
                    <PullRequestLabelChip
                      key={label.name}
                      label={label}
                      size="default"
                      className="max-w-48"
                    />
                  ))
                )}
              </span>
            </PullRequestMetaRow>
            <PullRequestMetaRow icon={<UsersIcon className="size-3.5" />} label={gt("Assignees")}>
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {seed.assignees.length === 0 ? (
                  <span className="text-muted-foreground">
                    <T context="no assignees">None</T>
                  </span>
                ) : (
                  seed.assignees.map((actor) => (
                    <PullRequestActorLabel key={actor.login} actor={actor} />
                  ))
                )}
              </span>
            </PullRequestMetaRow>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4 pt-3">
          <div className="flex h-7 items-center gap-2">
            <GhostBar className="size-4 rounded-full" />
            <GhostBar className="w-12" />
            <GhostBar className="w-32" />
          </div>
          <GhostBar className="h-5 w-3/4" />
          <GhostBar className="w-48" />
          <GhostBar className="w-32" />
        </div>
      )}
      <div className={cn("mt-4 flex flex-col gap-4", seed && "motion-safe:animate-skeleton")}>
        <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 p-3">
          <GhostBar className="w-20" />
          <GhostBar className="h-3.5 w-full" />
          <GhostBar className="h-3.5 w-5/6" />
          <GhostBar className="h-3.5 w-2/3" />
          <GhostBar className="h-3.5 w-3/4" />
        </div>
        <GhostBar className="w-16" />
        {[0, 1].map((row) => (
          <div key={row} className="flex items-start gap-2">
            <GhostBar className="size-5 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <GhostBar className="w-1/3" />
              <GhostBar className="w-full" />
              <GhostBar className="w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Personal build: the placeholder for an issue opened as a page. Same title and column as the
 * loaded page, so nothing moves when it lands.
 */
export function IssuePageGhost({ seed }: { seed?: IssueListEntry | null }) {
  const gt = useGT();
  const messages = useMessages();
  return (
    <div role="status" aria-label={gt("Loading issue")} className="flex min-h-0 flex-1 flex-col">
      <div className={cn("min-h-0 flex-1 overflow-hidden", PAGE_SCROLLER, PAGE_READING_COLUMN)}>
        <div className="flex flex-col gap-4 px-4">
          <div>
            <PullRequestDetailTitleRow className="mt-1 gap-1">
              {seed ? (
                <h2 className="min-w-0 flex-1 pr-7 text-base font-semibold leading-snug">
                  {seed.title}
                </h2>
              ) : (
                <GhostBar className="h-5 w-3/4 motion-safe:animate-skeleton" />
              )}
            </PullRequestDetailTitleRow>
            <PullRequestMetaLine className="mt-2 min-h-5 text-xs text-muted-foreground">
              {seed ? (
                <>
                  <PullRequestActorLabel actor={seed.author} />
                  <span>
                    <T>
                      opened{" "}
                      <Var>{formatRelativeTimeLabel(seed.createdAt, undefined, messages)}</Var>
                    </T>
                  </span>
                </>
              ) : (
                <GhostBar className="w-48 motion-safe:animate-skeleton" />
              )}
            </PullRequestMetaLine>
          </div>
          <div className="space-y-2 motion-safe:animate-skeleton">
            <PullRequestMetaRow icon={<TagIcon className="size-3.5" />} label={gt("Labels")}>
              <GhostBar className="w-24" />
            </PullRequestMetaRow>
            <PullRequestMetaRow icon={<UsersIcon className="size-3.5" />} label={gt("Assignees")}>
              <GhostBar className="w-20" />
            </PullRequestMetaRow>
          </div>
          <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 p-3 motion-safe:animate-skeleton">
            <GhostBar className="w-20" />
            <GhostBar className="h-3.5 w-full" />
            <GhostBar className="h-3.5 w-5/6" />
            <GhostBar className="h-3.5 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}
