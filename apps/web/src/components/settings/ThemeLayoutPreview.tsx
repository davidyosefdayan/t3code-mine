import type { ThemeColors } from "../../palette";

// A miniature of the app layout (rail, rounded panel with the page sidebar,
// chat column, composer) in one theme mode's colors. Used by the appearance
// picker, so the preview is the real structure rather than a generic window.
const PANEL = { light: "#fbfbfa", dark: "#0c0c0c" } as const;
const LINE = { light: "rgb(0 0 0 / 0.08)", dark: "rgb(255 255 255 / 0.08)" } as const;
const TEXT = { light: "rgb(0 0 0 / 0.14)", dark: "rgb(255 255 255 / 0.14)" } as const;

export function ThemeLayoutPreview({
  colors,
  mode,
  clip,
}: {
  colors: ThemeColors;
  mode: "light" | "dark";
  clip?: "left" | "right";
}) {
  const panel = PANEL[mode];
  const list = `color-mix(in oklab, ${colors.shell} ${mode === "dark" ? 55 : 22}%, ${panel})`;
  return (
    <span
      aria-hidden
      className="absolute inset-0 flex"
      style={{
        backgroundColor: colors.shell,
        clipPath:
          clip === "left"
            ? "polygon(0 0, 100% 0, 0 100%)"
            : clip === "right"
              ? "polygon(100% 0, 100% 100%, 0 100%)"
              : undefined,
      }}
    >
      {/* Rail */}
      <span className="flex w-1/7 flex-col items-center gap-1.5 pt-3">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-2 rounded-xs"
            style={{ backgroundColor: dot === 0 ? colors.chip : TEXT[mode] }}
          />
        ))}
      </span>
      {/* Panel: page sidebar + chat column */}
      <span
        className="my-1.5 me-1.5 flex flex-1 overflow-hidden rounded-md"
        style={{ backgroundColor: panel, boxShadow: `inset 0 0 0 1px ${LINE[mode]}` }}
      >
        <span className="flex w-[34%] flex-col gap-1 p-1.5" style={{ backgroundColor: list }}>
          <span className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: TEXT[mode] }} />
          <span className="mt-0.5 h-2.5 rounded-sm" style={{ backgroundColor: LINE[mode] }} />
          {[70, 85, 60, 75].map((width) => (
            <span
              key={width}
              className="h-1 rounded-full"
              style={{ width: `${width}%`, backgroundColor: TEXT[mode] }}
            />
          ))}
        </span>
        <span className="flex flex-1 flex-col justify-end gap-1 p-2">
          <span
            className="ms-auto h-2 w-1/2 rounded-sm"
            style={{ backgroundColor: `color-mix(in oklab, ${colors.accent} 14%, ${panel})` }}
          />
          <span className="h-1 w-4/5 rounded-full" style={{ backgroundColor: TEXT[mode] }} />
          <span className="h-1 w-3/5 rounded-full" style={{ backgroundColor: TEXT[mode] }} />
          <span
            className="mt-1 flex h-3.5 items-center justify-end rounded-md pe-0.5"
            style={{ boxShadow: `inset 0 0 0 1px ${LINE[mode]}` }}
          >
            <span className="size-2.5 rounded-full" style={{ backgroundColor: colors.accent }} />
          </span>
        </span>
      </span>
    </span>
  );
}
