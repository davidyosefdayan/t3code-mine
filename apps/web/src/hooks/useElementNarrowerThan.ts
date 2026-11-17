import { useSyncExternalStore } from "react";

import { observeResize } from "../lib/observeResize";

/** Whether the element is narrower than `width`; re-renders only when that answer flips. */
export function useElementNarrowerThan(element: HTMLElement | null, width: number): boolean {
  return useSyncExternalStore(
    (onChange) => (element ? observeResize(element, onChange) : () => {}),
    () => (element ? element.clientWidth < width : false),
  );
}
