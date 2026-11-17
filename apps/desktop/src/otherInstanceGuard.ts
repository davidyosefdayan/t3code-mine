// @effect-diagnostics nodeBuiltinImport:off - runs once at module load, before the Effect runtime.
import * as NodeChildProcess from "node:child_process";

import * as Electron from "electron";

// Personal build guard. This app shares ~/.t3 and its data folder with the
// official T3 Code app, and Electron skips its single-instance lock on macOS,
// so two copies could write the same chat database at once. Returns the name
// of another running T3 Code app, if any, so startup can stop before touching
// any data.
export function findOtherRunningT3Code(): string | null {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Runs before any Effect runtime.
  if (process.platform !== "darwin" || !Electron.app.isPackaged) return null;
  let processPaths: string[];
  try {
    processPaths = NodeChildProcess.execFileSync("/bin/ps", ["-axo", "comm="], {
      encoding: "utf8",
    }).split("\n");
  } catch {
    return null;
  }
  return findOtherT3CodeProcess(processPaths, process.execPath);
}

// Picks another T3 Code app bundle (the official "T3 Code (Beta)", a nightly,
// an older "T3 Code (Alpha)") out of `ps` executable paths, ignoring this one.
export function findOtherT3CodeProcess(
  processPaths: readonly string[],
  ownExecPath: string,
): string | null {
  const ownBundle = ownExecPath.slice(0, ownExecPath.indexOf(".app/") + 5);
  const other = processPaths.find(
    (path) => path.includes(".app/Contents/MacOS/T3 Code") && !path.startsWith(ownBundle),
  );
  return other === undefined ? null : other.slice(other.lastIndexOf("/") + 1);
}

// Shows why the app is not opening once Electron can draw a dialog, then quits.
export function explainAndQuit(otherName: string): void {
  void Electron.app.whenReady().then(() => {
    Electron.dialog.showMessageBoxSync({
      type: "warning",
      message: "T3 Code is already open",
      detail: `${otherName} is running and uses the same chats and settings. Quit it first, then open this app again.`,
      buttons: ["OK"],
    });
    Electron.app.exit(0);
  });
}
