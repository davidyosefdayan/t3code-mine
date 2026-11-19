import { describe, expect, it } from "vite-plus/test";

import {
  cliArchiveTarCommand,
  cliReleaseArchiveLocation,
  forkBuildOf,
  forkRuntimeVersion,
  newestCliReleaseVersion,
  newestForkBuildVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  t3-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *t3-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("t3-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("t3-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
    expect(newestCliReleaseVersion([{ tag_name: "v0.1.1001" }], "stable")).toBe("0.1.10");
    expect(newestCliReleaseVersion([{ tag_name: "v0.1.10" }], "stable")).toBe("0.1.10");
  });

  it("names fork builds after the fork release they were built for", () => {
    expect(forkRuntimeVersion("0.1.10", "0.1.1003")).toBe("0.1.10+1003");
    expect(forkRuntimeVersion("0.1.10", " 0.1.1003\n")).toBe("0.1.10+1003");
    // Fork version = upstream patch × 100 + fork release: 0.1.1101 is release 1 on upstream 0.1.11.
    expect(forkRuntimeVersion("0.1.11", "0.1.1101")).toBe("0.1.11+1101");
    expect(forkRuntimeVersion("0.1.11", "0.1.1102")).toBe("0.1.11+1102");
    for (const forkVersion of ["0.1.1004", "0.1.1100", "0.1.1201", "0.1.11"]) {
      expect(forkRuntimeVersion("0.1.11", forkVersion)).toBeUndefined();
    }
    // No fork version, one for another upstream, or no fork release on it: no fork build.
    for (const forkVersion of [undefined, "", "0.1.1103", "0.2.1003", "0.1.1000", "0.1.10", "x"]) {
      expect(forkRuntimeVersion("0.1.10", forkVersion)).toBeUndefined();
    }
    expect(forkBuildOf("0.1.10+1003")).toBe(1003);
    expect(forkBuildOf("0.1.11+1102")).toBe(1102);
    for (const version of ["0.1.10", "0.1.10+one", "0.1.10+build.1", "0.1.10-nightly.20260101.1"]) {
      expect(forkBuildOf(version)).toBeUndefined();
    }
  });

  it("downloads a fork build from its own release, named with the upstream version", () => {
    expect(cliReleaseArchiveLocation("0.1.10+1003")).toEqual({
      releaseVersion: "0.1.1003",
      archiveVersion: "0.1.10",
    });
    expect(cliReleaseArchiveLocation("0.1.11+1102")).toEqual({
      releaseVersion: "0.1.1102",
      archiveVersion: "0.1.11",
    });
    expect(cliReleaseArchiveLocation("0.1.10")).toEqual({
      releaseVersion: "0.1.10",
      archiveVersion: "0.1.10",
    });
  });

  it("finds the newest fork release, skipping the upstream-version archive release", () => {
    const releases = [
      { tag_name: "v0.1.10" },
      { tag_name: "v0.1.1003" },
      { tag_name: "v0.1.1004", draft: true },
      { tag_name: "v0.1.1101-beta" },
      { tag_name: "v0.1.1002" },
      { tag_name: "v0.1.902" },
    ];
    expect(newestForkBuildVersion(releases)).toBe("0.1.10+1003");
    expect(newestForkBuildVersion([{ tag_name: "v0.1.1101" }, ...releases])).toBe("0.1.11+1101");
    expect(
      newestForkBuildVersion([
        { tag_name: "v0.1.11" },
        { tag_name: "v0.1.1102" },
        { tag_name: "v0.1.1101" },
        ...releases,
      ]),
    ).toBe("0.1.11+1102");
    expect(newestForkBuildVersion([{ tag_name: "v0.1.10" }])).toBeUndefined();
  });
});
