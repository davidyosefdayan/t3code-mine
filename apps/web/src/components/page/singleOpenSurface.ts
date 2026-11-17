// Personal build: list pages with the list in their sidebar (Pull requests,
// Issues) show one item at a time, like a chat on Threads, so opening a row
// closes whatever was open before instead of piling up tabs.
import type { ScopedThreadRef } from "@t3tools/contracts";

import { selectSelectedRightPanelSurface, useRightPanelStore } from "../../rightPanelStore";

export function keepOnlySelectedSurface(ref: ScopedThreadRef): void {
  const store = useRightPanelStore.getState();
  const selected = selectSelectedRightPanelSurface(store.byThreadKey, ref);
  if (selected) store.closeOtherSurfaces(ref, selected.id);
}
