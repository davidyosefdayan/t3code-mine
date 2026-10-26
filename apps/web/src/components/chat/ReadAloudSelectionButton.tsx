// Personal build: "Listen" next to Cite on a selection in an answer. Reads from
// where the selection starts to the end, so starting mid-answer doesn't mean
// scrolling down to the speaker.
import { HeadphonesIcon } from "lucide-react";

import { listenFrom } from "~/readAloud/readAloudPlayer";
import { readableMessage } from "~/readAloud/readableMessages";
import { Button } from "../ui/button";

export function ReadAloudSelectionButton({
  messageId,
  range,
  onDone,
}: {
  messageId: string;
  range: Range;
  onDone: () => void;
}) {
  // Answers still being written have no speaker yet, and no Listen either.
  const message = readableMessage(messageId);
  if (!message) return null;
  return (
    <Button
      type="button"
      size="xs"
      variant="glass"
      aria-label="Listen from here"
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        listenFrom(messageId, message.threadKey, message.text, {
          node: range.startContainer,
          offset: range.startOffset,
        });
        window.getSelection()?.removeAllRanges();
        onDone();
      }}
    >
      <HeadphonesIcon aria-hidden="true" className="size-3.5" />
      Listen
    </Button>
  );
}
