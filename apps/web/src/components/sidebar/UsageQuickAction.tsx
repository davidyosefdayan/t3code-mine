import { ChartColumnBigIcon } from "lucide-react";

import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { UsageRailTooltip, useUsageRailRings } from "../usage/UsageRailIcon";

// Personal build: pinned "Open usage" in the top bar, styled like the bar's other buttons.
// Each provider's weekly limit left; hover lists them, click opens Usage.
export function UsageQuickAction({ onClick }: { readonly onClick: () => void }) {
  const rings = useUsageRailRings();
  const label =
    rings.length === 0
      ? "Open usage"
      : `Usage: ${rings.map((ring) => `${ring.label} ${ring.remainingPercent}% left`).join(", ")}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="flex h-7 shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-xs text-sidebar-muted-foreground outline-none hover:bg-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        {rings.length === 0 ? (
          <ChartColumnBigIcon className="size-4" />
        ) : (
          rings.map((ring) => (
            <span key={ring.driver} className="flex items-center gap-1">
              <ProviderInstanceIcon
                driverKind={ring.driver}
                displayName={ring.label}
                className="size-3.5"
                // Monochrome like the bar's other icons, not the brand colour.
                iconClassName="size-3.5 fill-current"
              />
              <span className="tabular-nums">{ring.remainingPercent}%</span>
            </span>
          ))
        )}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <UsageRailTooltip rings={rings} />
      </TooltipPopup>
    </Tooltip>
  );
}
