// Personal build: plays an answer aloud with the voice chosen in Settings → Read aloud.
// While it reads it becomes a stop button; the player bar above the composer has
// the rest of the controls; to start mid-answer, select text and press Listen.
import { memo, useEffect } from "react";
import { SquareIcon, Volume2Icon } from "lucide-react";

import { startReadAloud, stopReadAloud, useReadAloudState } from "~/readAloud/readAloudPlayer";
import { registerReadableMessage } from "~/readAloud/readableMessages";
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
  useEffect(
    () => registerReadableMessage(messageId, threadKey, text),
    [messageId, threadKey, text],
  );

  if (!active) {
    return (
      <ReadAloudControl
        label="Read aloud"
        onClick={() => startReadAloud(messageId, threadKey, text)}
      >
        <Volume2Icon className="size-3" />
      </ReadAloudControl>
    );
  }

  // Pause and the rest are in the player bar above the composer; here it starts and stops.
  return (
    <ReadAloudControl
      label={
        active.status === "loading" && active.downloadPercent !== null
          ? `Downloading voice… ${active.downloadPercent}%`
          : "Stop reading"
      }
      onClick={stopReadAloud}
    >
      {active.status === "loading" && active.downloadPercent !== null ? (
        <>
          <Spinner size="xs" />
          {/* The first use downloads the model; say so instead of a bare spinner. */}
          <span className="tabular-nums">Downloading voice {active.downloadPercent}%</span>
        </>
      ) : (
        <SquareIcon className="size-2.5 fill-current" />
      )}
    </ReadAloudControl>
  );
});
