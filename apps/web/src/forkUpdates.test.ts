import { describe, expect, it } from "vite-plus/test";

import { forkInstallPrompt, forkUpdatePrompt, isNewerVersion } from "./forkUpdates";

describe("isNewerVersion", () => {
  it("compares stable versions numerically", () => {
    expect(isNewerVersion("0.0.46", "0.0.45")).toBe(true);
    expect(isNewerVersion("v0.1.0", "0.0.99")).toBe(true);
    expect(isNewerVersion("0.0.45", "0.0.45")).toBe(false);
    expect(isNewerVersion("0.0.44", "0.0.45")).toBe(false);
    expect(isNewerVersion("0.1.701", "0.1.601")).toBe(true);
  });

  it("ignores versions it cannot read, such as nightlies", () => {
    expect(isNewerVersion("0.0.46-nightly.20261006.1", "0.0.45")).toBe(false);
  });
});

describe("forkUpdatePrompt", () => {
  it("names both versions and points to FORK.md", () => {
    const prompt = forkUpdatePrompt({ version: "0.0.46", url: "https://example.test" }, "0.0.45");
    expect(prompt).toContain("v0.0.46");
    expect(prompt).toContain("v0.0.45");
    expect(prompt).toContain("FORK.md");
  });
});

describe("forkInstallPrompt", () => {
  it("links the release's Mac build and waits for the app to quit", () => {
    const prompt = forkInstallPrompt(
      { version: "0.1.701", url: "https://example.test" },
      "0.1.601",
    );
    expect(prompt).toContain("/releases/download/v0.1.701/T3-Code-0.1.701-arm64.zip");
    expect(prompt).toContain("v0.1.601");
  });
});
