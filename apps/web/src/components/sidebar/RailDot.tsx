import { cn } from "../../lib/utils";

// Personal build: the dot on a rail button (chats waiting for you, an update).
// It takes the icon's color. The cutout matches the tile behind it: the shell,
// with the hover or selected fill on top, since those fills can be translucent.
// The button needs `relative group/rail-item`.
export function RailDot({ active = false }: { active?: boolean }) {
  return (
    <span aria-hidden="true" className="absolute top-1 right-1 size-3 rounded-full bg-sidebar-shell">
      <span
        className={cn(
          "flex size-full items-center justify-center rounded-full",
          active ? "bg-row-active" : "group-hover/rail-item:bg-row-hover",
        )}
      >
        <span className="size-2 rounded-full bg-current" />
      </span>
    </span>
  );
}
