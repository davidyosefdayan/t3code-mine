// Personal build: a theme's app icon made from its photo, so any theme with a photo
// (built-in or one the user adds) gets a matching Dock and taskbar icon.
const SIZE = 1024;

let cached: { readonly source: string; readonly icon: Promise<string | null> } | null = null;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function renderPhotoIcon(source: string): Promise<string | null> {
  const [photo, mask, mark] = await Promise.all([
    loadImage(source),
    loadImage("/theme-icon/mask.png"),
    loadImage("/theme-icon/mark.png"),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const side = Math.min(photo.naturalWidth, photo.naturalHeight);
  context.drawImage(
    photo,
    (photo.naturalWidth - side) / 2,
    (photo.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  context.fillStyle = "rgb(0 0 0 / 0.18)";
  context.fillRect(0, 0, SIZE, SIZE);
  context.shadowColor = "rgb(0 0 0 / 0.45)";
  context.shadowBlur = 28;
  context.drawImage(mark, 0, 0, SIZE, SIZE);
  context.shadowColor = "transparent";
  context.globalCompositeOperation = "destination-in";
  context.drawImage(mask, 0, 0, SIZE, SIZE);
  return canvas.toDataURL("image/png");
}

/** The photo cropped to the app icon's shape, dimmed slightly, with the T3 mark on top. */
export function themePhotoIcon(source: string): Promise<string | null> {
  if (cached?.source !== source) {
    cached = { source, icon: renderPhotoIcon(source).catch(() => null) };
  }
  return cached.icon;
}
