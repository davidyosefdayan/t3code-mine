import type { ThemeColors } from "../../palette";

// A to-scale miniature of the app (top bar, thin rail, rounded panel with the
// thread list and the chat) in one theme mode's colors, for the appearance
// picker. Proportions follow a 1280x800 window; surfaces follow index.css.
const CANVAS = { light: "#ffffff", dark: "#181818" } as const;
const RAISED = { light: "#ffffff", dark: "#222222" } as const;
const LINE = { light: "rgb(0 0 0 / 0.09)", dark: "rgb(255 255 255 / 0.08)" } as const;
const TEXT = { light: "rgb(0 0 0 / 0.55)", dark: "rgb(255 255 255 / 0.6)" } as const;
const FAINT = { light: "rgb(0 0 0 / 0.16)", dark: "rgb(255 255 255 / 0.18)" } as const;
const ON_FRAME = "rgb(255 255 255 / 0.5)";
const ON_LIGHT_FRAME = "rgb(0 0 0 / 0.3)";

function listColor(colors: ThemeColors, mode: "light" | "dark") {
  return mode === "dark"
    ? `oklch(from ${colors.shell} 0.2 calc(c * 0.5) h)`
    : `color-mix(in oklab, ${colors.shell} 22%, ${CANVAS.light})`;
}

function isDarkHex(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

export function ThemeLayoutPreview({
  colors,
  mode,
  clip,
}: {
  colors: ThemeColors;
  mode: "light" | "dark";
  clip?: "left" | "right";
}) {
  const frameInk = isDarkHex(colors.shell) ? ON_FRAME : ON_LIGHT_FRAME;
  const bar = (width: string, color: string, height = 2) => (
    <span
      className="block shrink-0 rounded-full"
      style={{ width, height, backgroundColor: color }}
    />
  );
  return (
    <span
      aria-hidden
      className="absolute inset-0 flex flex-col"
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
      {/* Top bar: app name on the left, search on the right half */}
      <span
        className="flex shrink-0 items-center pt-px"
        style={{ height: 9, gap: "3%", paddingInline: "2% 1%" }}
      >
        {bar("6%", frameInk)}
        <span
          className="ms-auto rounded-xs"
          style={{ height: 6, width: "45%", backgroundColor: colors.chip }}
        />
      </span>
      <span className="flex min-h-0 flex-1">
        {/* Rail: 56px of 1280 */}
        <span
          className="flex shrink-0 flex-col items-center gap-0.75 py-0.75"
          style={{ width: "4.4%" }}
        >
          <span
            className="rounded-xs"
            style={{ width: 7, height: 7, backgroundColor: colors.chip }}
          />
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-1 rounded-xs" style={{ backgroundColor: frameInk }} />
          ))}
          <span className="mt-auto size-1 rounded-full" style={{ backgroundColor: frameInk }} />
        </span>
        {/* Rounded panel: thread list + chat */}
        <span
          className="flex min-w-0 flex-1 overflow-hidden rounded-sm"
          style={{
            marginBottom: "1.5%",
            marginInlineEnd: "1%",
            backgroundColor: CANVAS[mode],
            boxShadow: `inset 0 0 0 0.5px ${LINE[mode]}`,
          }}
        >
          <span
            className="flex shrink-0 flex-col gap-0.75 pt-1"
            style={{
              width: "32%",
              paddingInline: "3%",
              backgroundColor: listColor(colors, mode),
              boxShadow: `inset -0.5px 0 0 ${LINE[mode]}`,
            }}
          >
            {bar("40%", TEXT[mode], 3)}
            <span
              className="mt-px block shrink-0 rounded-xs"
              style={{ height: 6, backgroundColor: LINE[mode] }}
            />
            {[78, 64, 84, 70].map((width, index) => (
              <span
                key={width}
                className="flex flex-col gap-0.5 pt-0.75"
                style={{ borderTop: index === 0 ? undefined : `0.5px solid ${LINE[mode]}` }}
              >
                {bar(`${width}%`, TEXT[mode])}
                {bar(`${width + 12}%`, FAINT[mode])}
              </span>
            ))}
          </span>
          {/* Chat: your bubble right, the answer left, composer at the bottom */}
          <span
            className="flex min-w-0 flex-1 flex-col gap-1 pt-2 pb-1.25"
            style={{ paddingInline: "6%" }}
          >
            <span
              className="ms-auto block rounded-xs"
              style={{ height: 9, width: "46%", backgroundColor: colors.accent }}
            />
            <span
              className="flex flex-col gap-0.5 rounded-xs p-0.75"
              style={{
                width: "78%",
                backgroundColor: `color-mix(in oklab, ${TEXT[mode]} 14%, ${CANVAS[mode]})`,
              }}
            >
              {bar("92%", FAINT[mode])}
              {bar("70%", FAINT[mode])}
            </span>
            <span
              className="mt-auto flex h-4 items-end justify-end rounded-sm p-0.5"
              style={{
                backgroundColor: RAISED[mode],
                boxShadow: `inset 0 0 0 0.5px ${LINE[mode]}`,
              }}
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: colors.accent }} />
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
