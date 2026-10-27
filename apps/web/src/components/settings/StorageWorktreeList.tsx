// Personal build: every worktree folder with its size and last cleanup
// outcome, so disk use can be traced and fixed from Settings → Storage.
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  StorageWorktreeDeletePlan,
  StorageWorktreeEntry,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { formatBytes } from "../../lib/formatBytes";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { storageWorktreesEnvironment } from "../../state/storageWorktrees";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsRow } from "./settingsLayout";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";
import { useSettingsScope } from "./SettingsScopeContext";

const worktreeListsAtom = environmentAtomList("web-storage-worktree-lists", (environmentId) =>
  storageWorktreesEnvironment.list({ environmentId, input: {} }),
);
const worktreePermissionsAtom = environmentAtomList(
  "web-storage-worktree-permissions",
  storageWorktreesEnvironment.delete.permissionAtom,
);

const PULL_REQUEST_STATE_LABELS = { open: "Open", closed: "Closed", merged: "Merged" } as const;
const OUTCOME_LABELS = { kept: "Kept", removed: "Deleted", failed: "Couldn't delete" } as const;

const folderName = (path: string) => path.split(/[\\/]/).findLast(Boolean) ?? path;
const plural = (count: number, word: string) =>
  `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`;
const failureMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const failure = squashAtomCommandFailure(result);
  return typeof failure === "object" && failure !== null && "message" in failure
    ? String(failure.message)
    : String(failure);
};

interface Target {
  readonly environmentId: EnvironmentId;
  readonly entry: StorageWorktreeEntry;
}

function DeleteWorktreeDialog({
  target,
  plan,
  checking,
  error,
  deleting,
  onConfirm,
  onClose,
}: {
  target: Target | null;
  plan: StorageWorktreeDeletePlan | null;
  checking: boolean;
  error: string | null;
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const entry = target?.entry;
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete worktree “{entry ? folderName(entry.path) : ""}”?
          </AlertDialogTitle>
          <AlertDialogDescription render={<div className="space-y-2" />}>
            {checking && <p>Checking the worktree…</p>}
            {plan && entry && (
              <>
                <p>
                  Deletes the folder <code className="wrap-anywhere">{entry.path}</code>.
                </p>
                <p>
                  {plan.branch
                    ? `Keeps the branch ${plan.branch} and its commits.`
                    : "No branch is checked out here, so commits that aren't on a branch are lost."}
                  {entry.threadId !== null &&
                    " Keeps the thread too. Sending it a message recreates the worktree from the branch."}
                </p>
                {plan.backupFiles > 0 && (
                  <p>
                    First copies {plural(plan.backupFiles, "file")} that only this worktree has to
                    the worktree-backups folder, where they stay for 30 days.
                  </p>
                )}
                {plan.changedFiles > 0 && (
                  <p className="text-destructive">
                    {plural(plan.changedFiles, "file")} {plan.changedFiles === 1 ? "has" : "have"}{" "}
                    uncommitted changes. The backup has them, but they won't be in the branch.
                  </p>
                )}
                {plan.notBackedUp !== null && (
                  <p className="text-destructive">
                    Ignored files over the 100 MB backup limit are deleted without a backup,
                    starting with <code className="wrap-anywhere">{plan.notBackedUp}</code>.
                  </p>
                )}
              </>
            )}
            {error && (
              <p aria-live="polite" className="text-destructive">
                {error}
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose disabled={deleting} render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button variant="destructive" disabled={plan === null || deleting} onClick={onConfirm}>
            {deleting ? "Deleting…" : plan?.needsConfirmation ? "Delete anyway" : "Delete worktree"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function WorktreeRow({
  environmentId,
  entry,
  environmentLabel,
  allowed,
  freeing,
  onFree,
  onDelete,
}: {
  environmentId: EnvironmentId;
  entry: StorageWorktreeEntry;
  environmentLabel: string | null;
  allowed: boolean;
  freeing: boolean;
  onFree: () => void;
  onDelete: () => void;
}) {
  const size = !entry.measured
    ? "Measuring…"
    : entry.bytes === null
      ? "Size unknown"
      : entry.packageBytes
        ? `${formatBytes(entry.bytes)} (${formatBytes(entry.packageBytes)} packages)`
        : formatBytes(entry.bytes);
  return (
    <SettingsRow
      title={
        <span className="wrap-anywhere select-text">
          {[environmentLabel, entry.projectName, folderName(entry.path)]
            .filter(Boolean)
            .join(" / ")}
        </span>
      }
      description={
        <span className="block space-y-1 wrap-anywhere select-text">
          <span className="block">
            {entry.threadId !== null ? (
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: entry.threadId }}
                className="text-foreground/80 underline underline-offset-2"
              >
                {entry.threadTitle}
              </Link>
            ) : (
              "No thread"
            )}
            {entry.pullRequest && (
              <>
                {" · "}
                <a
                  href={entry.pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  PR #{entry.pullRequest.number}
                </a>
                {entry.pullRequest.state &&
                  ` ${PULL_REQUEST_STATE_LABELS[entry.pullRequest.state]}`}
              </>
            )}
          </span>
          <span
            className={`block ${entry.lastCleanup?.outcome === "failed" ? "text-destructive" : ""}`}
          >
            {entry.lastCleanup
              ? `${OUTCOME_LABELS[entry.lastCleanup.outcome]}: ${entry.lastCleanup.reason}`
              : "Not checked by cleanup yet"}
          </span>
          <code className="block text-foreground/70">{entry.path}</code>
        </span>
      }
      control={
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs text-muted-foreground">{size}</span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              disabled={!allowed || freeing || entry.packageBytes === 0}
              onClick={onFree}
            >
              {freeing ? "Freeing…" : "Free packages"}
            </Button>
            <Button variant="ghost-destructive" size="xs" disabled={!allowed} onClick={onDelete}>
              Delete…
            </Button>
          </div>
        </div>
      }
    />
  );
}

export function StorageWorktreeList() {
  const { connectedEnvironments } = useSettingsScope();
  const supported = connectedEnvironments.filter(
    (environment) => environment.serverConfig?.environment.capabilities.storageWorktrees === true,
  );
  const supportedIds = supported.map(({ environmentId }) => environmentId);
  const lists = useAtomValue(worktreeListsAtom(environmentIdsKey(supportedIds)));
  const permissions = useAtomValue(worktreePermissionsAtom(environmentIdsKey(supportedIds)));
  const freePackages = useAtomCommand(storageWorktreesEnvironment.freePackages);
  const deleteWorktree = useAtomCommand(storageWorktreesEnvironment.delete);
  const [freeing, setFreeing] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [plan, setPlan] = useState<StorageWorktreeDeletePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  if (supported.length === 0) return null;

  const rows = supported.flatMap((environment, index) => {
    const query = lists[index]!;
    if (query._tag !== "Success") return [];
    return query.value.entries.map((entry) => ({
      environment,
      allowed: permissions[index]!,
      entry,
    }));
  });
  // Unmeasured folders sort last, then the largest first.
  rows.sort((left, right) => (right.entry.bytes ?? -1) - (left.entry.bytes ?? -1));
  const measuring = supported.some((_, index) => {
    const query = lists[index]!;
    return query._tag === "Success" ? query.value.measuring : query.waiting;
  });
  const totalBytes = rows.reduce((sum, row) => sum + (row.entry.bytes ?? 0), 0);
  const packageBytes = rows.reduce((sum, row) => sum + (row.entry.packageBytes ?? 0), 0);

  const free = async (environmentId: EnvironmentId, entry: StorageWorktreeEntry) => {
    setFreeing(entry.path);
    const result = await freePackages({ environmentId, input: { path: entry.path } });
    setFreeing(null);
    if (result._tag === "Success") {
      toastManager.add(
        result.value.folders === 0
          ? { type: "info", title: "No packages to free" }
          : {
              type: "success",
              title: `Freed ${formatBytes(result.value.bytes)}`,
              description: `Deleted ${plural(result.value.folders, "folder")} such as node_modules. Installing or building in the worktree brings them back.`,
            },
      );
    } else if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Couldn't free packages",
        description: failureMessage(result),
      });
    }
  };

  const openDelete = async (next: Target) => {
    setTarget(next);
    setPlan(null);
    setPlanError(null);
    const result = await deleteWorktree({
      environmentId: next.environmentId,
      input: { path: next.entry.path, dryRun: true, allowLocalChanges: false },
    });
    if (result._tag === "Success") setPlan(result.value);
    else if (!isAtomCommandInterrupted(result)) setPlanError(failureMessage(result));
  };

  const confirmDelete = async () => {
    if (target === null || plan === null) return;
    setDeleting(true);
    const result = await deleteWorktree({
      environmentId: target.environmentId,
      input: {
        path: target.entry.path,
        dryRun: false,
        allowLocalChanges: plan.needsConfirmation,
      },
    });
    setDeleting(false);
    if (result._tag === "Success") {
      setTarget(null);
      toastManager.add({
        type: "success",
        title: "Worktree deleted",
        ...(result.value.backupPath ? { description: `Backup: ${result.value.backupPath}` } : {}),
      });
    } else if (!isAtomCommandInterrupted(result)) {
      setPlan(null);
      setPlanError(failureMessage(result));
    }
  };

  return (
    <>
      <FoldedSettingsSection
        id="storage-worktree-folders"
        title="Worktree folders"
        headerPlacement="inside"
        summary={
          rows.length === 0
            ? measuring
              ? "Loading…"
              : "No worktree folders"
            : `${plural(rows.length, "folder")}, ${formatBytes(totalBytes)}${packageBytes > 0 ? ` (${formatBytes(packageBytes)} packages)` : ""}${measuring ? ", measuring…" : ""}`
        }
      >
        <SettingsRow
          title="Folders in your worktree locations"
          description="Largest first. Free packages deletes folders that installs and builds recreate, such as node_modules, and never touches code. Delete removes the folder and keeps its branch. Sizes count cloned files in full, so deleting can free less than shown."
        />
        {rows.map(({ environment, allowed, entry }) => (
          <WorktreeRow
            key={`${environment.environmentId}:${entry.path}`}
            environmentId={environment.environmentId}
            entry={entry}
            environmentLabel={
              supported.length > 1
                ? settingsScopeEnvironmentLabel(environment, connectedEnvironments)
                : null
            }
            allowed={allowed}
            freeing={freeing === entry.path}
            onFree={() => void free(environment.environmentId, entry)}
            onDelete={() => void openDelete({ environmentId: environment.environmentId, entry })}
          />
        ))}
      </FoldedSettingsSection>
      <DeleteWorktreeDialog
        target={target}
        plan={plan}
        checking={target !== null && plan === null && planError === null}
        error={planError}
        deleting={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setTarget(null)}
      />
    </>
  );
}
