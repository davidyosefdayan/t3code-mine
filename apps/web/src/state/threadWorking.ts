// Personal build: one "still working" decision, including Working's 2 s exit grace, that
// the Working group, the unread mark, the Dock badge, and the done beep all read, so a
// chat leaves Working, turns unread, and beeps together.
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { createInboxReturnTracker } from "@t3tools/client-runtime/state/thread-inbox";
import type { AtomRegistry } from "effect/reactivity";
import { useSyncExternalStore } from "react";

import { environmentThreadShells } from "./threads";

type WorkingInput = Parameters<ReturnType<typeof createInboxReturnTracker>["isWorking"]>[0];

export function createThreadWorkingSignal() {
  const tracker = createInboxReturnTracker();
  const listeners = new Set<() => void>();
  let isWorking = (thread: WorkingInput) => tracker.isWorking(thread);
  let version = 0;
  // A new function per change, so cached reads of it recompute.
  const changed = () => {
    isWorking = (thread) => tracker.isWorking(thread);
    version += 1;
    for (const listener of listeners) listener();
  };
  tracker.subscribe(changed);
  return {
    observe(threads: readonly EnvironmentThreadShell[]) {
      const before = threads.map((thread) => tracker.isWorking(thread));
      // Upstream skips the hold for pinned chats, which never sit in its Working shelf;
      // here a pinned chat works in Working too, so it gets the same hold.
      tracker.observe(
        threads.map((thread) => (thread.pinnedAt == null ? thread : { ...thread, pinnedAt: null })),
      );
      if (threads.some((thread, index) => tracker.isWorking(thread) !== before[index])) changed();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isWorking: () => isWorking,
    version: () => version,
    returnedAt: (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
      tracker.returnedAt(thread),
  };
}

export const threadWorking = createThreadWorkingSignal();

/** Feeds every chat to the tracker from app start, whichever page is open. */
export function startThreadWorkingTracker(registry: AtomRegistry.AtomRegistry): () => void {
  return registry.subscribe(
    environmentThreadShells.quietThreadShellsAtom,
    (threads) => threadWorking.observe(threads),
    { immediate: true },
  );
}

/** Whether a chat is still in Working; changes identity whenever any chat moves. */
export function useThreadIsWorking() {
  return useSyncExternalStore(threadWorking.subscribe, threadWorking.isWorking);
}
