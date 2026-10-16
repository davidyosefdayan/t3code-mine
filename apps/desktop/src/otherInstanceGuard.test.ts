import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

import { findOtherT3CodeProcess } from "./otherInstanceGuard.ts";

const ownExecPath = "/Applications/T3 Code (Mine).app/Contents/MacOS/T3 Code (Mine)";

describe("findOtherT3CodeProcess", () => {
  it("finds the official app", () => {
    expect(
      findOtherT3CodeProcess(
        [
          "/usr/sbin/cfprefsd",
          ownExecPath,
          "/Applications/T3 Code (Beta).app/Contents/MacOS/T3 Code (Beta)",
        ],
        ownExecPath,
      ),
    ).toBe("T3 Code (Beta)");
  });

  it("ignores this app and its helpers", () => {
    expect(
      findOtherT3CodeProcess(
        [
          ownExecPath,
          "/Applications/T3 Code (Mine).app/Contents/Frameworks/T3 Code (Mine) Helper.app/Contents/MacOS/T3 Code (Mine) Helper",
          "/Applications/Other.app/Contents/MacOS/Other",
        ],
        ownExecPath,
      ),
    ).toBeNull();
  });
});
