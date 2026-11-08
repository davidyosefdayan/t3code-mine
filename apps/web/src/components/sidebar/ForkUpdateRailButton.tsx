import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import {
  FORK_PROJECT_FOLDER,
  forkInstallPrompt,
  forkReleaseCheck,
  forkUpdatePrompt,
  upstreamReleaseCheck,
} from "../../forkUpdates";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { useProjects } from "../../state/entities";
import { primaryServerConfigAtom } from "../../state/server";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DesktopUpdateStatusIcon } from "./DesktopUpdateStatusIcon";
import { RailDot } from "./RailDot";

// The fork's rail update control. When a release is out, clicking opens a chat
// with instructions waiting in the composer (forkUpdates.ts): "upstream" moves
// the fork onto upstream's release in the fork's project (maintainer builds);
// "release" installs the fork's newest release in a No project chat (unsigned Mac builds).
export function ForkUpdateRailButton({ source }: { source: "upstream" | "release" }) {
  const serverVersion = useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;
  const appVersion = useDesktopUpdateState()?.currentVersion ?? null;
  const releaseCheck = source === "upstream" ? upstreamReleaseCheck : forkReleaseCheck;
  const currentVersion = source === "upstream" ? serverVersion : appVersion;
  const { checking, update, checkedAt } = releaseCheck.use(currentVersion);
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  // Keep the spinner turning for at least one full turn on a manual check, so a
  // fast response still reads as "checked".
  const [spinning, setSpinning] = useState(false);

  const startUpdateChat = async () => {
    if (update === null || currentVersion === null) return;
    if (source === "release") {
      // Installing needs no repo, so it runs as a No project chat.
      const environmentId = scratchEnvironmentId(null);
      const project = environmentId === null ? null : await openScratchProject(environmentId);
      if (project) {
        await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
          prompt: forkInstallPrompt(update, currentVersion),
        });
      }
      return;
    }
    const project = projects.find((candidate) =>
      candidate.workspaceRoot.replace(/\/+$/, "").endsWith(`/${FORK_PROJECT_FOLDER}`),
    );
    if (!project) {
      toastManager.add({
        type: "error",
        title: "No T3 Code project",
        description: `Add the fork's folder ("${FORK_PROJECT_FOLDER}") as a project to start the update chat there.`,
      });
      return;
    }
    const draft = await handleNewThread(scopeProjectRef(project.environmentId, project.id));
    if (draft) {
      useComposerDraftStore
        .getState()
        .setPrompt(draft.draftId, forkUpdatePrompt(update, currentVersion));
    }
  };

  const onClick = () => {
    if (update !== null) {
      void startUpdateChat();
      return;
    }
    setSpinning(true);
    void releaseCheck.check();
  };

  const isChecking = checking || spinning;
  const label =
    update !== null
      ? source === "upstream"
        ? `T3 Code v${update.version} is out. Start the update chat`
        : `T3 Code (Mine) v${update.version} is out. Start the update chat`
      : isChecking
        ? "Checking for updates…"
        : checkedAt !== null && currentVersion !== null
          ? `Up to date (v${currentVersion}). Check again`
          : "Check for updates";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="group/rail-item relative flex size-9 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[update=true]:text-sidebar-foreground"
            data-update={update !== null}
          />
        }
      >
        {/* The update dot is the rail's dot, like the chats one. */}
        {update !== null ? (
          <>
            <DownloadIcon className="size-4" />
            <RailDot />
          </>
        ) : (
          <DesktopUpdateStatusIcon
            status={isChecking ? "checking" : "idle"}
            isCheckAnimating={isChecking}
            onCheckAnimationIteration={() => {
              if (!checking) setSpinning(false);
            }}
          />
        )}
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}
