import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { readLocalApi } from "../../localApi";
import { useProjects } from "../../state/entities";
import { skillsEnvironment } from "../../state/skills";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

type CommandResult = { readonly _tag: string };

function failureMessage(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** The Skills page's actions, each reporting its own failure as a toast. */
export function useSkillActions() {
  const create = useAtomCommand(skillsEnvironment.create, { reportFailure: false });
  const save = useAtomCommand(skillsEnvironment.save, { reportFailure: false });
  const setEnabled = useAtomCommand(skillsEnvironment.setEnabled, { reportFailure: false });
  const share = useAtomCommand(skillsEnvironment.share, { reportFailure: false });
  const remove = useAtomCommand(skillsEnvironment.delete, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const { openScratchProject } = useScratchProject();
  const projects = useProjects();

  // Narrowing helper: true on success, a toast and false otherwise.
  const succeeded = <R extends CommandResult>(result: R, title: string) => {
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result as never)) {
      toastManager.add({ type: "error", title, description: failureMessage(result as never) });
    }
    return false;
  };

  /**
   * Opens a new chat with `prompt` waiting in the composer: in the project
   * when one is given, otherwise without a project.
   */
  const startChat = useCallback(
    async (environmentId: EnvironmentId, prompt: string, projectRoot?: string) => {
      const project =
        projectRoot === undefined
          ? await openScratchProject(environmentId)
          : (projects.find(
              (candidate) =>
                candidate.environmentId === environmentId &&
                candidate.workspaceRoot === projectRoot,
            ) ?? null);
      if (!project) return;
      const draft = await handleNewThread(scopeProjectRef(project.environmentId, project.id));
      if (draft) useComposerDraftStore.getState().setPrompt(draft.draftId, prompt);
    },
    [handleNewThread, openScratchProject, projects],
  );

  return {
    create: async (...args: Parameters<typeof create>) => {
      const result = await create(...args);
      return succeeded(result, "Could not create the skill") && result._tag === "Success"
        ? result.value
        : null;
    },
    save: async (...args: Parameters<typeof save>) =>
      succeeded(await save(...args), "Could not save the skill"),
    setEnabled: async (...args: Parameters<typeof setEnabled>) =>
      succeeded(
        await setEnabled(...args),
        args[0].input.enabled ? "Could not enable the skill" : "Could not disable the skill",
      ),
    share: async (...args: Parameters<typeof share>) =>
      succeeded(await share(...args), "Could not share the skill"),
    remove: async (input: {
      readonly environmentId: EnvironmentId;
      readonly path: string;
      readonly displayName: string;
    }) => {
      const confirmed = await readLocalApi()?.dialogs.confirm(
        [
          `Delete the skill "${input.displayName}"?`,
          "Its folder moves to the Trash on a Mac and is deleted permanently elsewhere. Any other provider that loads it through a link loses it too. If this provider only had a link, just the link is removed.",
        ].join("\n"),
        { variant: "destructive" },
      );
      if (!confirmed) return false;
      const result = await remove({
        environmentId: input.environmentId,
        input: { path: input.path },
      });
      return succeeded(result, "Could not delete the skill");
    },
    startChat,
  };
}
