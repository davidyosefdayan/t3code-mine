import { ImageIcon, PipetteIcon } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";

import { MAX_THEME_BACKDROP_LENGTH } from "../../themePalette";
import { type PhotoThemeSeed, photoThemeSeed } from "../../themePhotoColors";
import { Button } from "../ui/button";

// Personal build: the theme editor's photo, which the stock editor lacks.

const PHOTO_MAX_SIDE = 1600;
const SAMPLE_SIDE = 48;

function sampleSeed(source: CanvasImageSource): PhotoThemeSeed | null {
  const sample = document.createElement("canvas");
  sample.width = SAMPLE_SIDE;
  sample.height = SAMPLE_SIDE;
  const context = sample.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  return photoThemeSeed(context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data);
}

/** The colors of a photo already on the theme, which keeps no sample of its own. */
async function photoSeedOf(photo: string): Promise<PhotoThemeSeed | null> {
  // An image, not fetch: the desktop app's content policy blocks fetching data URLs.
  const image = new Image();
  image.src = photo;
  await image.decode();
  return sampleSeed(image);
}

// Scales the photo down to a JPEG that fits the theme's size limit, and samples its colors.
async function readPhoto(file: File): Promise<{ photo: string; seed: PhotoThemeSeed | null }> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let photo = "";
    for (const quality of [0.85, 0.7, 0.55]) {
      photo = canvas.toDataURL("image/jpeg", quality);
      if (photo.length <= MAX_THEME_BACKDROP_LENGTH) break;
    }
    if (photo.length > MAX_THEME_BACKDROP_LENGTH) throw new Error("The photo is too large.");

    return { photo, seed: sampleSeed(bitmap) };
  } finally {
    bitmap.close();
  }
}

export function ThemePhotoField({
  photo,
  picksColors,
  onChange,
  onUseColors,
}: {
  photo: string | undefined;
  /** Whether a new photo also sets the theme's colors (guided mode). */
  picksColors: boolean;
  onChange: (photo: string | undefined, seed: PhotoThemeSeed | null) => void;
  /** Sets the theme's colors from the current photo; absent where colors are set by hand. */
  onUseColors?: (seed: PhotoThemeSeed) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);

  const choose = (file: File | undefined) => {
    if (!file) return;
    setFailed(false);
    readPhoto(file).then(
      ({ photo: next, seed }) => onChange(next, seed),
      () => setFailed(true),
    );
  };
  const dropHandlers = {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      choose(event.dataTransfer.files[0]);
    },
  };

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-medium">Photo</h3>
        <p className="text-xs text-muted-foreground">
          {picksColors
            ? "Fills the frame around the chat. Its colors become the theme's."
            : "Fills the frame around the chat."}
        </p>
      </div>
      {photo ? (
        <div
          {...dropHandlers}
          data-dragging={dragging || undefined}
          className="relative aspect-[5/2] overflow-hidden rounded-lg border border-border data-dragging:ring-2 data-dragging:ring-ring data-dragging:ring-inset"
        >
          <img src={photo} alt="" draggable={false} className="size-full object-cover" />
          <div className="absolute right-2 bottom-2 flex gap-1.5">
            {onUseColors ? (
              <Button
                size="xs"
                variant="overlay"
                onClick={() => {
                  setFailed(false);
                  photoSeedOf(photo).then(
                    (seed) => (seed ? onUseColors(seed) : setFailed(true)),
                    () => setFailed(true),
                  );
                }}
              >
                <PipetteIcon />
                Use its colors
              </Button>
            ) : null}
            <Button size="xs" variant="overlay" onClick={() => inputRef.current?.click()}>
              Change
            </Button>
            <Button size="xs" variant="overlay" onClick={() => onChange(undefined, null)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          {...dropHandlers}
          data-dragging={dragging || undefined}
          onClick={() => inputRef.current?.click()}
          className="flex aspect-[5/2] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-dragging:border-ring data-dragging:bg-muted/50"
        >
          <ImageIcon className="size-5" />
          <span className="text-sm font-medium text-foreground">Add a photo</span>
          <span className="text-xs">Drop an image here or click to choose one</span>
        </button>
      )}
      {failed ? (
        <p aria-live="polite" className="text-xs text-destructive">
          That image couldn't be read. Try a JPEG, PNG or WebP.
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          choose(file);
        }}
      />
    </section>
  );
}
