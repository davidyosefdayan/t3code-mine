import { describe, expect, it } from "vite-plus/test";

import { forkUpdatePrompt, isNewerVersion } from "./forkUpdates";

describe("isNewerVersion", () => {
  it("compares stable versions numerically", () => {
    expect(isNewerVersion("0.0.46", "0.0.45")).toBe(true);
    expect(isNewerVersion("v0.1.0", "0.0.99")).toBe(true);
    expect(isNewerVersion("0.0.45", "0.0.45")).toBe(false);
    expect(isNewerVersion("0.0.44", "0.0.45")).toBe(false);
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
