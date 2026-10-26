// Personal build: lets the read-aloud player bar scroll the chat to the message
// being read, even when the list hasn't rendered that far.
import type { LegendListRef } from "@legendapp/list/react";
import { useEffect, useEffectEvent, type RefObject } from "react";

import { registerReadAloudReveal } from "./readAloudPlayer";

export function useReadAloudReveal({
  rows,
  listRef,
  enabled,
  onManualNavigation,
}: {
  rows: readonly { readonly kind: string; readonly message?: { readonly id: string } }[];
  listRef: RefObject<LegendListRef | null>;
  enabled: boolean;
  onManualNavigation: () => void;
}) {
  const reveal = useEffectEvent(async (messageId: string) => {
    // Otherwise a chat resting at the bottom scrolls straight back there.
    onManualNavigation();
    const rendered = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    const index = rows.findIndex((row) => row.kind === "message" && row.message?.id === messageId);
    const list = listRef.current;
    if (rendered || index < 0 || !list) return;
    await list.scrollToIndex({ index, animated: false, viewOffset: 24 });
    // The row mounts on the next frame; the player then scrolls to the word itself.
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  useEffect(() => {
    if (!enabled) return;
    return registerReadAloudReveal((messageId) => reveal(messageId));
  }, [enabled]);
}
