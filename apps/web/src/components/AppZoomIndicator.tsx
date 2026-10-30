// Personal build: like a browser's zoom bubble. Zooming the app (Cmd +/-)
// shows the current size in the top right with buttons to step back to 100%.
import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";
import { Button } from "./ui/button";

const HIDE_AFTER_MS = 2500;

// App zoom changes the CSS viewport, so resize also signals zoom changes.
const subscribeToWindowZoom = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};
const readWindowZoomPercent = () =>
  Math.round((window.desktopBridge?.getWindowZoomFactor?.() ?? 1) * 100);

export function AppZoomIndicator() {
  const percent = useSyncExternalStore(subscribeToWindowZoom, readWindowZoomPercent);
  const [shownPercent, setShownPercent] = useState(percent);
  // The zoom the bubble opened (or last restarted its timer) for.
  const [visibleFor, setVisibleFor] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  if (percent !== shownPercent) {
    setShownPercent(percent);
    setVisibleFor(percent);
  }
  const visible = visibleFor !== null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Hides the bubble a moment after the last zoom change, unless the pointer is on it.
  useEffect(() => {
    if (visibleFor === null || hovered) return;
    const timer = window.setTimeout(() => setVisibleFor(null), HIDE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [visibleFor, hovered]);

  const zoom = (direction: "in" | "out" | "reset") => {
    void window.desktopBridge?.zoomWindow?.(direction);
  };
  // Browsers show their own zoom; only the desktop app can zoom from here.
  if (window.desktopBridge?.zoomWindow === undefined) return null;

  return (
    <div
      role="status"
      aria-hidden={!visible}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={cn(
        // z-100 like toasts: the workspace header controls are their own z-50 layer.
        "fixed top-11 right-3 z-100 flex items-center gap-0.5 rounded-xl border border-border bg-popover py-1 ps-3.5 pe-1 text-popover-foreground shadow-lg transition-opacity duration-150",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <span className="me-1.5 min-w-10 text-sm font-semibold tabular-nums">{percent}%</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom out"
        tabIndex={visible ? 0 : -1}
        onClick={() => zoom("out")}
      >
        <MinusIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom in"
        tabIndex={visible ? 0 : -1}
        onClick={() => zoom("in")}
      >
        <PlusIcon />
      </Button>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <Button
        variant="ghost"
        size="xs"
        disabled={percent === 100}
        tabIndex={visible ? 0 : -1}
        onClick={() => zoom("reset")}
      >
        Reset
      </Button>
    </div>
  );
}
