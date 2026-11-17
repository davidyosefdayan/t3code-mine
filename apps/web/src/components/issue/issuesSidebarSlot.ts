// Personal build: where the Issues sidebar lets the page draw its list, as on
// Pull requests, so the list sits in the sidebar while its state stays in the page.
import { useSyncExternalStore } from "react";

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setIssuesSidebarSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useIssuesSidebarSlot(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => slot,
    () => null,
  );
}
