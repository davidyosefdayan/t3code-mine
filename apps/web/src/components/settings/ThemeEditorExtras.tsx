import { ImageIcon } from "lucide-react";
import { useRef } from "react";

import { Button } from "../ui/button";

// Personal build: theme editor fields the stock editor lacks.

const ICON_SIZE = 192;

// Scales the picked image to a square PNG so the theme (stored in local storage) stays small.
async function toIconDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  const side = Math.min(bitmap.width, bitmap.height);
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    ICON_SIZE,
    ICON_SIZE,
  );
  bitmap.close();
  return canvas.toDataURL("image/png");
}

export function ThemeIconField({
  appearance,
  icon,
  onChange,
}: {
  appearance: "light" | "dark";
  icon: string | undefined;
  onChange: (icon: string | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-3">
      <span className="text-sm font-medium">
        {appearance === "dark" ? "Dark icon" : "Light icon"}
      </span>
      <div className="flex items-center gap-2">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {icon ? (
            <img src={icon} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-4 text-muted-foreground" />
          )}
        </span>
        <Button size="xs" variant="outline" onClick={() => inputRef.current?.click()}>
          {icon ? "Change" : "Upload"}
        </Button>
        {icon ? (
          <Button size="xs" variant="ghost" onClick={() => onChange(undefined)}>
            Remove
          </Button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void toIconDataUrl(file).then(onChange, () => {});
          }}
        />
      </div>
    </div>
  );
}
