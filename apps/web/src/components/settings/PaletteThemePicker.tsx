import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import { COLOR_THEMES, setPalette, usePalette } from "../../palette";
import type { ThemePreferenceMode } from "../../themePalette";
import { ThemeLayoutPreview } from "./ThemeLayoutPreview";

const MODES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies ReadonlyArray<{ value: ThemePreferenceMode; label: string }>;

const tileClassName =
  "flex cursor-pointer flex-col items-stretch gap-2 rounded-xl border p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function useSelectedTheme() {
  const id = usePalette();
  return COLOR_THEMES.find((theme) => theme.id === id) ?? COLOR_THEMES[0];
}

// Light / Dark / System, each previewed as the app layout in the current theme.
export function AppearanceModePicker() {
  const { appearanceMode, setAppearanceMode } = useTheme();
  const theme = useSelectedTheme();
  return (
    <div aria-label="Appearance mode" role="group" className="grid grid-cols-3 gap-3">
      {MODES.map((mode) => {
        const active = appearanceMode === mode.value;
        return (
          <button
            key={mode.value}
            type="button"
            aria-pressed={active}
            onClick={() => setAppearanceMode(mode.value)}
            className={cn(
              tileClassName,
              active
                ? "border-transparent bg-accent ring-2 ring-primary"
                : "border-border/70 hover:bg-accent/60",
            )}
          >
            <span className="relative block h-36 overflow-hidden rounded-lg">
              {mode.value === "system" ? (
                <>
                  <ThemeLayoutPreview colors={theme.light} mode="light" clip="left" />
                  <ThemeLayoutPreview colors={theme.dark} mode="dark" clip="right" />
                </>
              ) : (
                <ThemeLayoutPreview colors={theme[mode.value]} mode={mode.value} />
              )}
            </span>
            <span
              className={cn(
                "text-center text-xs font-medium",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {mode.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The color themes, each shown by its app icon.
export function ColorThemePicker() {
  const theme = useSelectedTheme();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
      {COLOR_THEMES.map((option) => {
        const selected = option.id === theme.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            onClick={() => setPalette(option.id)}
            className={cn(
              tileClassName,
              "items-center gap-2 py-3",
              selected
                ? "border-transparent bg-accent ring-2 ring-primary"
                : "border-transparent hover:bg-accent/60",
            )}
          >
            <img
              src={`/palette-icons/${option.id}.png`}
              alt=""
              draggable={false}
              className="size-14 drop-shadow-sm"
            />
            <span className="text-xs font-medium text-foreground">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
