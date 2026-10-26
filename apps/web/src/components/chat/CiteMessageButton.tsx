// Personal build: Cite under an answer quotes the whole message in your reply,
// next to Copy and Read aloud. Selecting part of it and pressing Cite still
// quotes just that part.
import { QuoteIcon } from "lucide-react";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { citeWholeMessage } from "./citeWholeMessage";

export function CiteMessageButton({ messageId }: { messageId: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Cite message"
            type="button"
            size="xs"
            variant="ghost-muted"
            onClick={(event) => {
              const result = citeWholeMessage(event.currentTarget, messageId);
              if (result === "too-long") {
                toastManager.add({
                  type: "info",
                  title: "Too long to cite whole",
                  description: "Select the part you want and press Cite.",
                });
              }
            }}
          />
        }
      >
        <QuoteIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup>
        <p>Cite message</p>
      </TooltipPopup>
    </Tooltip>
  );
}
