import type { EnvironmentId, PullRequestLinkedThreadsResult } from "@t3tools/contracts";

import { dispatchCommandPalette, isCommandPaletteMounted } from "./commandPaletteStore";

export interface CommandPaletteLinkedThreads {
  readonly environmentId: EnvironmentId;
  readonly threads: PullRequestLinkedThreadsResult["threads"];
}

export interface CommandPaletteOpenDetail {
  readonly open?: "add-project" | "new-thread-in";
  readonly query?: string;
  readonly linkedThreads?: CommandPaletteLinkedThreads;
}

export function openCommandPalette(detail: CommandPaletteOpenDetail = {}): void {
  // With no palette on screen (e.g. /pair) the request is dropped; kept in the
  // store, it would pop a stale palette once the app shell mounts.
  if (!isCommandPaletteMounted()) return;
  if (detail.open === "new-thread-in") {
    dispatchCommandPalette({ _tag: "OpenNewThreadIn" });
  } else if (detail.open === "add-project") {
    dispatchCommandPalette({ _tag: "OpenAddProject" });
  } else if (detail.query !== undefined) {
    dispatchCommandPalette({
      _tag: "OpenSearch",
      query: detail.query,
      ...(detail.linkedThreads ? { linkedThreads: detail.linkedThreads } : {}),
    });
  } else {
    dispatchCommandPalette({ _tag: "SetOpen", open: true });
  }
}

/** True while the palette popup is on screen, including its closing animation. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}

/** Personal build: runs a palette row by its value, as if clicked (a submenu opens). */
export function runCommandPaletteItem(value: string, title: string): void {
  if (!isCommandPaletteMounted()) return;
  dispatchCommandPalette({ _tag: "RunItem", value, title });
}

// Personal build: a pinned action finished, so its top bar button can confirm (a copy's check).
const QUICK_ACTION_RAN_EVENT = "t3code:quick-action-ran";

export function announceQuickActionRan(value: string): void {
  window.dispatchEvent(new CustomEvent<string>(QUICK_ACTION_RAN_EVENT, { detail: value }));
}

export function onQuickActionRan(listener: (value: string) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(QUICK_ACTION_RAN_EVENT, handle);
  return () => window.removeEventListener(QUICK_ACTION_RAN_EVENT, handle);
}
