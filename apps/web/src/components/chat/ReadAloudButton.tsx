// Personal build: plays an answer aloud with the voice chosen in Settings → Read aloud.
// Pause keeps your place. With text selected in the answer, reading starts there.
import { memo } from "react";
import { PauseIcon, PlayIcon, SquareIcon, Volume2Icon } from "lucide-react";

import {
  pauseReadAloud,
  resumeReadAloud,
  startReadAloud,
  stopReadAloud,
  useReadAloudState,
} from "~/readAloud/readAloudPlayer";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function ReadAloudControl({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            onClick={onClick}
            type="button"
            size="xs"
            variant="ghost-muted"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}

/** Where the selection starts, if text is selected; the player ignores it outside this answer. */
function selectionStart() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  return { node: range.startContainer, offset: range.startOffset };
}

export const ReadAloudButton = memo(function ReadAloudButton({
  messageId,
  threadKey,
  text,
}: {
  messageId: string;
  threadKey: string;
  text: string;
}) {
  const state = useReadAloudState();
  const active = state.status !== "idle" && state.key === messageId ? state : null;

  if (!active) {
    return (
      <ReadAloudControl
        label="Read aloud"
        onClick={() => startReadAloud(messageId, threadKey, text, selectionStart())}
      >
        <Volume2Icon className="size-3" />
      </ReadAloudControl>
    );
  }

  return (
    <>
      {active.status === "loading" ? (
        <ReadAloudControl
          label={
            active.downloadPercent !== null
              ? `Downloading voice… ${active.downloadPercent}%`
              : "Starting…"
          }
          onClick={stopReadAloud}
        >
          <Spinner size="xs" />
          {/* The first use downloads the model; say so instead of a bare spinner. */}
          {active.downloadPercent !== null ? (
            <span className="tabular-nums">Downloading voice {active.downloadPercent}%</span>
          ) : null}
        </ReadAloudControl>
      ) : active.status === "paused" ? (
        <ReadAloudControl label="Resume" onClick={resumeReadAloud}>
          <PlayIcon className="size-3 fill-current" />
        </ReadAloudControl>
      ) : (
        <ReadAloudControl label="Pause" onClick={pauseReadAloud}>
          <PauseIcon className="size-3 fill-current" />
        </ReadAloudControl>
      )}
      <ReadAloudControl label="Stop reading" onClick={stopReadAloud}>
        <SquareIcon className="size-2.5 fill-current" />
      </ReadAloudControl>
    </>
  );
});
