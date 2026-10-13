import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Electron from "electron";

function encodeWindowsIcon(image: Electron.NativeImage): Buffer {
  const png = image.resize({ width: 256, height: 256, quality: "best" }).toPNG();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

function updatePinnedShortcuts(input: {
  readonly appDataDirectory: string;
  readonly executablePath: string;
  readonly iconPath: string;
}): void {
  const directory = NodePath.join(
    input.appDataDirectory,
    "Microsoft",
    "Internet Explorer",
    "Quick Launch",
    "User Pinned",
    "TaskBar",
  );
  let names: string[];
  try {
    names = NodeFS.readdirSync(directory);
  } catch {
    return;
  }
  const executable = NodePath.win32.normalize(input.executablePath).toLowerCase();
  for (const name of names) {
    if (NodePath.extname(name).toLowerCase() !== ".lnk") continue;
    const path = NodePath.join(directory, name);
    try {
      const shortcut = Electron.shell.readShortcutLink(path);
      if (NodePath.win32.normalize(shortcut.target).toLowerCase() !== executable) continue;
      if (shortcut.icon === input.iconPath && shortcut.iconIndex === 0) continue;
      Electron.shell.writeShortcutLink(path, "update", {
        target: shortcut.target,
        icon: input.iconPath,
        iconIndex: 0,
      });
    } catch {
      continue;
    }
  }
}

export function prepareWindowsPaletteIcon(input: {
  readonly image: Electron.NativeImage;
  readonly iconPath: string;
  readonly appId: string;
  readonly displayName: string;
  readonly executablePath: string;
  readonly userDataDirectory: string;
  readonly appDataDirectory: string;
  readonly isPackaged: boolean;
}): Electron.AppDetailsOptions | null {
  let iconPath = input.iconPath;
  if (NodePath.extname(iconPath).toLowerCase() !== ".ico") {
    try {
      const content = NodeFS.readFileSync(iconPath);
      const digest = NodeCrypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
      const directory = NodePath.join(input.userDataDirectory, "palette-icons");
      iconPath = NodePath.join(directory, `${NodePath.parse(iconPath).name}-${digest}.ico`);
      if (!NodeFS.existsSync(iconPath)) {
        NodeFS.mkdirSync(directory, { recursive: true });
        NodeFS.writeFileSync(iconPath, encodeWindowsIcon(input.image));
      }
    } catch {
      return null;
    }
  }
  if (input.isPackaged) {
    updatePinnedShortcuts({ ...input, iconPath });
  }
  return {
    appId: input.appId,
    appIconPath: iconPath,
    appIconIndex: 0,
    ...(input.isPackaged
      ? {
          relaunchCommand: `"${input.executablePath}"`,
          relaunchDisplayName: input.displayName,
        }
      : {}),
  };
}
