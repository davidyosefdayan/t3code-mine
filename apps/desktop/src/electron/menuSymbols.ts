// Personal build: icons in native context menus on macOS.
//
// Menu items name their icon with the Lucide keyword the web menu draws. The
// native menu shows the closest SF Symbol instead, so menus look like the rest
// of macOS. Keywords without a symbol here show no icon.
export const SF_SYMBOL_BY_MENU_ICON: Readonly<Record<string, string>> = {
  archive: "archivebox",
  "circle-check": "checkmark.circle",
  clock: "clock",
  copy: "doc.on.doc",
  folder: "folder",
  "folder-tree": "folder",
  "git-branch": "arrow.triangle.branch",
  hash: "number",
  "mail-open": "envelope.open",
  "message-square-plus": "plus.bubble",
  pencil: "pencil",
  pin: "pin",
  "pin-off": "pin.slash",
  play: "play",
  "refresh-cw": "arrow.clockwise",
  settings: "gearshape",
  smile: "face.smiling",
  timer: "timer",
  trash: "trash",
};
