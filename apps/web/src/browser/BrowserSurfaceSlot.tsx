import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface } from "./browserSurfaceStore";
import { observeResize } from "../lib/observeResize";

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    zIndex = 30,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const presentationRef = useRef({ visible, cornerRadius, zIndex });
  const updateRef = useRef<(() => void) | null>(null);

  // The lease lives as long as this element for one tab, so the ref callback owns it.
  const attachSurface = (element: HTMLDivElement) => {
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    const update = () => {
      const rect = element.getBoundingClientRect();
      const presentation = presentationRef.current;
      const presented = lease.present(
        {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        },
        presentation.visible && rect.width > 0 && rect.height > 0,
        presentation.cornerRadius || sharedPanelCornerRadius(element, rect),
        presentation.zIndex,
      );
      if (presentation.visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(
          {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          },
          rect.width > 0 && rect.height > 0,
          presentation.cornerRadius || sharedPanelCornerRadius(element, rect),
          presentation.zIndex,
        );
      }
    };
    updateRef.current = update;
    update();
    const observed: Element[] = [element];
    // Inline shells animate without resizing the slot, so observe the shell too.
    const panel = element.closest('[data-preview-panel-mode="inline"]');
    if (panel) observed.push(panel);
    // Sidebar width changes move the slot without changing its size or column offset.
    observed.push(...document.querySelectorAll('[data-slot="sidebar-gap"]'));
    const stopObserving = observeResize(observed, update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      stopObserving();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  };

  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius, zIndex };
    updateRef.current?.();
  }, [
    cornerRadius,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A layoutVersion bump means the slot moved without resizing, so it re-presents at the new position.
    layoutVersion,
    visible,
    zIndex,
  ]);

  return <div ref={attachSurface} className={className} data-browser-surface-slot={tabId} />;
}

/**
 * Personal build: the browser draws in a fixed layer above the app, outside the
 * rounded main panel's clipping, so a square layer pokes past the panel's corner.
 * Rounds the corners the slot shares with that panel to match it.
 */
function sharedPanelCornerRadius(element: HTMLElement, rect: DOMRect): string | 0 {
  const panel = element.closest<HTMLElement>("[data-slot='sidebar-inset']");
  if (!panel) return 0;
  const bounds = panel.getBoundingClientRect();
  const style = getComputedStyle(panel);
  const top = Math.abs(rect.top - bounds.top - parseFloat(style.borderTopWidth)) <= 1;
  const right = Math.abs(bounds.right - parseFloat(style.borderRightWidth) - rect.right) <= 1;
  const bottom = Math.abs(bounds.bottom - parseFloat(style.borderBottomWidth) - rect.bottom) <= 1;
  const left = Math.abs(rect.left - bounds.left - parseFloat(style.borderLeftWidth)) <= 1;
  // The panel clips its content to the inside of its border.
  const inner = (shared: boolean, radius: string, border: string) =>
    shared ? Math.max(0, parseFloat(radius) - parseFloat(border)) : 0;
  const radii = [
    inner(top && left, style.borderTopLeftRadius, style.borderTopWidth),
    inner(top && right, style.borderTopRightRadius, style.borderTopWidth),
    inner(bottom && right, style.borderBottomRightRadius, style.borderBottomWidth),
    inner(bottom && left, style.borderBottomLeftRadius, style.borderBottomWidth),
  ];
  return radii.some((radius) => radius > 0) ? radii.map((radius) => `${radius}px`).join(" ") : 0;
}
