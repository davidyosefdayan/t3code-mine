// Personal build: plays an answer aloud with the voice chosen in Settings → Read aloud.
import { memo } from "react";
import { SquareIcon, Volume2Icon } from "lucide-react";

import { startReadAloud, stopReadAloud, useReadAloudState } from "~/readAloud/readAloudPlayer";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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
  const label = !active
    ? "Read aloud"
    : active.status === "playing"
      ? "Stop reading"
      : active.downloadPercent !== null
        ? `Downloading voice… ${active.downloadPercent}%`
        : "Starting…";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            onClick={() => (active ? stopReadAloud() : startReadAloud(messageId, threadKey, text))}
            type="button"
            size="xs"
            variant="ghost-muted"
          />
        }
      >
        {!active ? (
          <Volume2Icon className="size-3" />
        ) : active.status === "loading" ? (
          <Spinner size="xs" />
        ) : (
          <SquareIcon className="size-2.5 fill-current" />
        )}
        {/* The first use downloads the model; say so instead of a bare spinner. */}
        {active?.downloadPercent != null ? (
          <span className="tabular-nums">Downloading voice {active.downloadPercent}%</span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
});
