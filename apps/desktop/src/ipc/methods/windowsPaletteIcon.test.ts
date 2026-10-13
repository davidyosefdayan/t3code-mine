import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const shell = vi.hoisted(() => ({ readShortcutLink: vi.fn(), writeShortcutLink: vi.fn() }));
vi.mock("electron", () => ({ shell }));

import { prepareWindowsPaletteIcon } from "./windowsPaletteIcon.ts";

let directory: string;
const png = Buffer.from("the resized palette PNG");
const toPNG = vi.fn(() => png);
const resize = vi.fn(() => ({ toPNG }));
const image = { resize } as unknown as Electron.NativeImage;

function input() {
  return {
    image,
    iconPath: NodePath.join(directory, "blueberry.png"),
    appId: "com.t3tools.t3code.mine",
    displayName: "T3 Code (Alpha)",
    executablePath: "C:\\Apps\\T3 Code (Mine).exe",
    userDataDirectory: NodePath.join(directory, "userdata"),
    appDataDirectory: NodePath.join(directory, "appdata"),
    isPackaged: true,
  };
}

function pin(name: string, target = input().executablePath) {
  const path = NodePath.join(
    input().appDataDirectory,
    "Microsoft",
    "Internet Explorer",
    "Quick Launch",
    "User Pinned",
    "TaskBar",
    name,
  );
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, "fake shortcut");
  return { path, target };
}

beforeEach(() => {
  vi.resetAllMocks();
  resize.mockReturnValue({ toPNG });
  toPNG.mockReturnValue(png);
  directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-palette-icon-"));
  NodeFS.writeFileSync(input().iconPath, "blueberry source");
});

afterEach(() => NodeFS.rmSync(directory, { recursive: true, force: true }));

describe("prepareWindowsPaletteIcon", () => {
  it("creates a 256px PNG-backed ICO and supplies taskbar relaunch metadata", () => {
    const details = prepareWindowsPaletteIcon(input())!;
    const ico = NodeFS.readFileSync(details.appIconPath!);

    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(0);
    expect(ico.readUInt16LE(10)).toBe(1);
    expect(ico.readUInt16LE(12)).toBe(32);
    expect(ico.readUInt32LE(14)).toBe(png.length);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.subarray(22)).toEqual(png);
    expect(resize).toHaveBeenCalledWith({ width: 256, height: 256, quality: "best" });
    expect(details).toMatchObject({
      appId: input().appId,
      appIconIndex: 0,
      relaunchCommand: '"C:\\Apps\\T3 Code (Mine).exe"',
      relaunchDisplayName: input().displayName,
    });
  });

  it("reuses an unchanged palette's ICO without re-encoding it", () => {
    const first = prepareWindowsPaletteIcon(input());
    expect(prepareWindowsPaletteIcon(input())).toEqual(first);
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it("changes the icon resource when a palette asset is updated", () => {
    const first = prepareWindowsPaletteIcon(input());
    NodeFS.writeFileSync(input().iconPath, "updated blueberry source");
    expect(prepareWindowsPaletteIcon(input())?.appIconPath).not.toBe(first?.appIconPath);
  });

  it("uses the original ICO when a palette has no themed PNG", () => {
    const iconPath = NodePath.join(directory, "default.ico");
    expect(prepareWindowsPaletteIcon({ ...input(), iconPath })?.appIconPath).toBe(iconPath);
    expect(resize).not.toHaveBeenCalled();
  });

  it("updates only this executable's pinned shortcut without replacing its launch options", () => {
    const matching = pin("Mine.lnk", input().executablePath.toUpperCase());
    const other = pin("Official.lnk", "C:\\Apps\\T3 Code.exe");
    shell.readShortcutLink.mockImplementation((path) => ({
      target: path === matching.path ? matching.target : other.target,
      args: "--existing-option",
      icon: "old.ico",
      iconIndex: 0,
    }));

    const details = prepareWindowsPaletteIcon(input());
    expect(shell.writeShortcutLink.mock.calls).toEqual([
      [
        matching.path,
        "update",
        { target: matching.target, icon: details?.appIconPath, iconIndex: 0 },
      ],
    ]);
  });

  it("does not rewrite a pinned shortcut that already has this icon", () => {
    const details = prepareWindowsPaletteIcon(input());
    pin("Mine.lnk");
    shell.readShortcutLink.mockReturnValue({
      target: input().executablePath,
      icon: details?.appIconPath,
      iconIndex: 0,
    });
    prepareWindowsPaletteIcon(input());
    expect(shell.writeShortcutLink).not.toHaveBeenCalled();
  });

  it("switches the pinned icon back to the default ICO", () => {
    const matching = pin("Mine.lnk");
    shell.readShortcutLink.mockReturnValue({
      target: input().executablePath,
      icon: "blueberry.ico",
    });
    const iconPath = NodePath.join(directory, "default.ico");
    prepareWindowsPaletteIcon({ ...input(), iconPath });
    expect(shell.writeShortcutLink).toHaveBeenCalledWith(matching.path, "update", {
      target: input().executablePath,
      icon: iconPath,
      iconIndex: 0,
    });
  });

  it("does not change packaged shortcuts or relaunch commands in development", () => {
    pin("Mine.lnk");
    const details = prepareWindowsPaletteIcon({ ...input(), isPackaged: false });
    expect(details).not.toHaveProperty("relaunchCommand");
    expect(details).not.toHaveProperty("relaunchDisplayName");
    expect(shell.readShortcutLink).not.toHaveBeenCalled();
  });

  it("keeps working when a pinned shortcut cannot be read", () => {
    pin("Broken.lnk");
    shell.readShortcutLink.mockImplementation(() => {
      throw new Error("unreadable shortcut");
    });
    expect(prepareWindowsPaletteIcon(input())?.appIconPath).toMatch(/\.ico$/);
  });

  it("leaves window-icon fallback available when the ICO cache cannot be written", () => {
    const userDataDirectory = NodePath.join(directory, "not-a-directory");
    NodeFS.writeFileSync(userDataDirectory, "file");
    expect(prepareWindowsPaletteIcon({ ...input(), userDataDirectory })).toBeNull();
  });
});
