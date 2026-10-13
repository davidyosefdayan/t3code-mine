// @effect-diagnostics nodeBuiltinImport:off - small synchronous lookup inside an IPC handler.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as DesktopAssets from "../../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_DOCK_PALETTE_ICON_CHANNEL } from "../channels.ts";
import { prepareWindowsPaletteIcon } from "./windowsPaletteIcon.ts";

// Personal build: the app icon follows the selected color palette: the Dock on
// macOS, each window's icon (what the taskbar shows) on Windows and Linux.
// Icons are bundled as resources/palette-icons/<palette>.png; a palette
// without one falls back to the app's own icon.
const PaletteId = Schema.String.check(Schema.isPattern(/^[a-z]{1,32}$/));

export const installDockPaletteIcon = Effect.fn("desktop.ipc.installDockPaletteIcon")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const platform = yield* HostProcessPlatform;
  const iconPaths = yield* (yield* DesktopAssets.DesktopAssets).iconPaths;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  // The icon windows opened later should get too; null keeps the default.
  let windowIcon: Electron.NativeImage | null = null;
  let windowAppDetails: Electron.AppDetailsOptions | null = null;
  const applyWindowIcon = (window: Electron.BrowserWindow) => {
    if (window.isDestroyed()) return;
    if (windowIcon) window.setIcon(windowIcon);
    if (windowAppDetails) window.setAppDetails(windowAppDetails);
  };
  if (platform !== "darwin") {
    Electron.app.on("browser-window-created", (_event, window) => {
      applyWindowIcon(window);
    });
  }
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_DOCK_PALETTE_ICON_CHANNEL,
      payload: PaletteId,
      result: Schema.Void,
      handler: (palette) =>
        Effect.sync(() => {
          // oxlint-disable-next-line t3code/no-global-process-runtime -- Electron resources path.
          const iconPath = NodePath.join(process.resourcesPath, "palette-icons", `${palette}.png`);
          if (platform !== "darwin") {
            const fallbackPath = Option.getOrNull(
              platform === "win32" ? iconPaths.ico : iconPaths.png,
            );
            const path = NodeFS.existsSync(iconPath) ? iconPath : fallbackPath;
            if (path === null) return;
            const image = Electron.nativeImage.createFromPath(path);
            if (image.isEmpty()) return;
            windowIcon = image;
            if (platform === "win32") {
              windowAppDetails = prepareWindowsPaletteIcon({
                image,
                iconPath: path,
                appId: environment.appUserModelId,
                displayName: environment.displayName,
                executablePath: Electron.app.getPath("exe"),
                userDataDirectory: Electron.app.getPath("userData"),
                appDataDirectory: environment.appDataDirectory,
                isPackaged: environment.isPackaged,
              });
            }
            for (const window of Electron.BrowserWindow.getAllWindows()) {
              applyWindowIcon(window);
            }
            return;
          }
          if (!Electron.app.dock) return;
          // oxlint-disable-next-line t3code/no-global-process-runtime -- Electron resources path.
          const fallbackPath = NodePath.join(process.resourcesPath, "icon.icns");
          const path = NodeFS.existsSync(iconPath) ? iconPath : fallbackPath;
          const image = Electron.nativeImage.createFromPath(path);
          if (!image.isEmpty()) Electron.app.dock.setIcon(image);
          persistBundleIcon(path);
        }),
    }),
  );
});

// The Dock shows the app bundle's own icon while the app is closed, so the
// palette icon is also set as the bundle's custom Finder icon. Skipped when
// the same icon was already applied, so launches stay quick.
let lastBundleIcon: string | null = null;
function persistBundleIcon(iconPath: string): void {
  if (!Electron.app.isPackaged || lastBundleIcon === iconPath) return;
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Electron executable path.
  const execPath = process.execPath;
  const appIndex = execPath.indexOf(".app/");
  if (appIndex === -1) return;
  const appPath = execPath.slice(0, appIndex + 4);
  const markerPath = NodePath.join(Electron.app.getPath("userData"), "mine-bundle-icon.txt");
  try {
    if (NodeFS.readFileSync(markerPath, "utf8") === iconPath) {
      lastBundleIcon = iconPath;
      return;
    }
  } catch {
    // No marker yet.
  }
  lastBundleIcon = iconPath;
  const script = `ObjC.import("AppKit");
const image = $.NSImage.alloc.initWithContentsOfFile(${JSON.stringify(iconPath)});
$.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, ${JSON.stringify(appPath)}, 0);`;
  // setIcon reports false rather than throwing when macOS blocks the write
  // (Privacy & Security > App Management), so only a "true" marks it applied;
  // anything else retries on the next launch or palette change.
  NodeChildProcess.execFile(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", script],
    (error, stdout) => {
      if (error === null && stdout.trim() === "true") {
        NodeFS.writeFile(markerPath, iconPath, () => {});
      } else if (lastBundleIcon === iconPath) {
        lastBundleIcon = null;
      }
    },
  );
}
