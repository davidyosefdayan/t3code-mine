import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import {
  checkForForkUpdate,
  FORK_PROJECT_FOLDER,
  forkUpdatePrompt,
  useForkUpdate,
} from "../../forkUpdates";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects } from "../../state/entities";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DesktopUpdateStatusIcon } from "./DesktopUpdateStatusIcon";

// Personal build: the rail's update control, in T3 Code's own update icon
// style. It checks GitHub for a newer stable release on its own every few hours;
// clicking checks now, or, when an update is out, opens a chat in the fork's
// project with the update instructions waiting in the composer (forkUpdates.ts).
export function ForkUpdateRailButton() {
  const { checking, update, checkedAt, currentVersion } = useForkUpdate();
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  // Keep the spinner turning for at least one full turn on a manual check, so a
  // fast response still reads as "checked".
  const [spinning, setSpinning] = useState(false);

  const startUpdateChat = async () => {
    if (update === null || currentVersion === null) return;
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
    void checkForForkUpdate();
  };

  const isChecking = checking || spinning;
  const label =
    update !== null
      ? `T3 Code v${update.version} is out. Start the update chat`
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
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[update=true]:text-sidebar-foreground"
            data-update={update !== null}
          />
        }
      >
        <DesktopUpdateStatusIcon
          status={update !== null ? "available" : isChecking ? "checking" : "idle"}
          isCheckAnimating={isChecking}
          onCheckAnimationIteration={() => {
            if (!checking) setSpinning(false);
          }}
        />
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}
