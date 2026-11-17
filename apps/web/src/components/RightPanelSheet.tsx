import { T } from "gt-react";
import { useEffect, type ReactNode } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "./ui/sheet";
import { useMobileSidebarSheetMounted } from "./ui/sidebar";

export function RightPanelSheet(props: {
  animationDurationMs: number;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const onClose = useStableCallback(props.onClose);
  const listSheetOpen = useMobileSidebarSheetMounted();
  // Personal build: narrow windows float one panel at a time. Both sheets share a layer, so the
  // list opening from the page header would otherwise slide in under this one.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the list sheet is the sidebar store's state, opened by its own trigger and shortcut
  useEffect(() => {
    if (listSheetOpen) onClose();
  }, [listSheetOpen, onClose]);

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        // Base UI's dismiss handler fires on held Esc repeats after a nested popup closes.
        if (eventDetails.reason === "escape-key" && eventDetails.event.repeat) {
          return eventDetails.cancel();
        }
        props.onClose();
      }}
    >
      {/* Personal build: floats under the top bar like the main panel, not over it. */}
      <SheetPopup
        transitionDurationMs={props.animationDurationMs}
        side="right"
        variant="panel"
        showCloseButton={false}
        keepMounted
        className="w-[min(42vw,28rem)] min-w-80 max-w-[28rem] max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>
            <T>Workspace panel</T>
          </SheetTitle>
        </SheetHeader>
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
