import { UsageProviderKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";

const STORAGE_KEY = "t3code:usage-page-preferences:v1";
const UsagePagePreferencesSchema = Schema.Struct({
  metric: Schema.Literals(["cost", "tokens", "limits"]),
  windowDays: Schema.Literals([1, 7, 30, 90]),
  hiddenProviders: Schema.optional(Schema.Array(UsageProviderKind)),
  /** Personal build: provider tab under Limits (a driver kind); absent opens the tightest. */
  provider: Schema.optional(Schema.String),
  /** Personal build: the unit Spend last showed, so returning to it from Limits keeps it. */
  spendMetric: Schema.optional(Schema.Literals(["cost", "tokens"])),
});
export type UsagePagePreferences = typeof UsagePagePreferencesSchema.Type;

const DEFAULT_PREFERENCES: UsagePagePreferences = { metric: "limits", windowDays: 30 };

export function readUsagePagePreferences(): UsagePagePreferences {
  try {
    return getLocalStorageItem(STORAGE_KEY, UsagePagePreferencesSchema) ?? DEFAULT_PREFERENCES;
  } catch (error) {
    console.error("Could not read Usage page preferences.", error);
    return DEFAULT_PREFERENCES;
  }
}

export function saveUsagePagePreferences(preferences: UsagePagePreferences): void {
  try {
    setLocalStorageItem(STORAGE_KEY, preferences, UsagePagePreferencesSchema);
  } catch (error) {
    console.error("Could not save Usage page preferences.", error);
  }
}

/**
 * Personal build: saves a view picked outside the page, such as the Usage
 * sidebar. Opening Usage without one in the URL shows the saved view.
 */
export function rememberUsageView(metric: UsagePagePreferences["metric"]): void {
  const { provider, ...rest } = readUsagePagePreferences();
  saveUsagePagePreferences({
    ...rest,
    metric,
    ...(metric === "limits" && provider ? { provider } : {}),
    ...(metric !== "limits" ? { spendMetric: metric } : {}),
  });
}
