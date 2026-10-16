import { useEffect, useEffectEvent, type ReactNode } from "react";

import { useCloseAppModal } from "./sidebar/mainAppLocation";
import { SidebarInset } from "./ui/sidebar";

/**
 * Personal build: Settings and Usage are pages beside their own sidebar in the
 * app rail, not upstream's large modal over the thread. Esc still returns to
 * the page that opened them. Keyboard guards that skip dialogs exempt
 * `[data-app-modal]`, because these pages own their shortcuts.
 */
export function AppRouteModal({ label, children }: { label: string; children: ReactNode }) {
  const closeAppModal = useCloseAppModal();
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.key !== "Escape")
      return;
    event.preventDefault();
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    void closeAppModal();
  });
  useEffect(() => {
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  return (
    <SidebarInset
      aria-label={label}
      data-app-modal=""
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {children}
      </div>
    </SidebarInset>
  );
}

/** Personal build: pages have no close button; the rail and Esc leave them. */
export function AppRouteModalClose() {
  return null;
}
