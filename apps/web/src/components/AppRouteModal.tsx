import { useRouter } from "@tanstack/react-router";
import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  type ReactNode,
  type RefObject,
} from "react";

import { GlobalVoiceInputIndicator } from "./chat/GlobalVoiceInputIndicator";
import { useCloseAppModal } from "./sidebar/mainAppLocation";
import { SidebarInset } from "./ui/sidebar";

/**
 * Personal build: Settings and Usage are pages beside their own sidebar in the
 * app rail, not upstream's large modal over the thread. Esc still returns to
 * the page that opened them. Keyboard guards that skip dialogs exempt
 * `[data-app-modal]`, because these pages own their shortcuts.
 */
export function AppRouteModal({
  label,
  actionsRef,
  children,
}: {
  label: string;
  actionsRef?: RefObject<DialogPrimitive.Root.Actions | null>;
  children: ReactNode;
}) {
  const closeAppModal = useCloseAppModal();
  // Callers close upstream's modal through its actions; on a page that leaves it.
  useImperativeHandle(actionsRef, () => ({
    close: () => void closeAppModal(),
    unmount: () => void closeAppModal(),
  }));
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.key !== "Escape")
      return;
    event.preventDefault();
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    void closeAppModal();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener that closes the page on Escape
  useEffect(() => {
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  const router = useRouter();
  // Leaving the page unmounts a focused field without a blur, so commit-on-blur rows would
  // drop what was typed. Blur text fields before the navigation renders.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- router listener that blurs a field before navigation unmounts it
  useEffect(
    () =>
      router.subscribe("onBeforeLoad", ({ pathChanged }) => {
        const focused = document.activeElement;
        if (
          pathChanged &&
          focused instanceof HTMLElement &&
          focused.matches("input, textarea, [contenteditable]")
        ) {
          focused.blur();
        }
      }),
    [router],
  );

  return (
    <SidebarInset
      aria-label={label}
      data-app-modal=""
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {children}
      </div>
      <GlobalVoiceInputIndicator />
    </SidebarInset>
  );
}

/** Personal build: pages have no close button; the rail and Esc leave them. */
export function AppRouteModalClose() {
  return null;
}
