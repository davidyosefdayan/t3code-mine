import { ProviderDriverKind } from "@t3tools/contracts";
import { collectLimitPools, type LimitAccount } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import { railRingOf } from "./weeklyLimit";

const WEEK_MINS = 7 * 24 * 60;

function account(key: string, usedPercent: number, resetsAt: string): LimitAccount {
  return {
    key,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: key,
    email: undefined,
    plan: undefined,
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: {
      checkedAt: "2026-09-10T12:00:00.000Z",
      windows: [
        {
          id: "seven_day",
          kind: "weekly",
          label: "Weekly",
          usedPercent,
          windowDurationMins: WEEK_MINS,
          resetsAt,
        },
      ],
    },
  };
}

describe("railRingOf", () => {
  it("reads pace, time left and the next reset from the accounts behind a pooled week", () => {
    const now = Date.parse("2026-09-10T12:00:00.000Z");
    // Two days into one week and five days into the other.
    const accounts = [
      account("a", 10, "2026-09-15T12:00:00.000Z"),
      account("b", 90, "2026-09-12T12:00:00.000Z"),
    ];
    const ring = railRingOf(collectLimitPools(accounts, now)[0]!, now);
    expect(ring).toMatchObject({ remainingPercent: 50, pace: "on", timeLeftPercent: 50 });
    expect(ring?.nextReset?.resetsAt).toBe("2026-09-12T12:00:00.000Z");
  });
});
