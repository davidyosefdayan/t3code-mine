// Personal build: a speaker on the sidebar row of the chat being read aloud.
// Clicking it stops reading, from anywhere in the app.
import { Volume2Icon } from "lucide-react";
import type { MouseEvent } from "react";

import { stopReadAloud, useReadAloudState } from "~/readAloud/readAloudPlayer";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ReadAloudThreadIndicator({ threadKey }: { threadKey: string }) {
  const state = useReadAloudState();
  if (state.status === "idle" || state.threadKey !== threadKey) return null;

  const stop = (event: MouseEvent) => {
    // The row opens the chat on click; this button only stops reading.
    event.stopPropagation();
    stopReadAloud();
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Stop reading aloud"
            onClick={stop}
            className="inline-flex shrink-0 cursor-pointer items-center rounded-md text-primary hover:text-foreground"
          />
        }
      >
        <Volume2Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">Reading aloud · click to stop</TooltipPopup>
    </Tooltip>
  );
}
