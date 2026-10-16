import { createFileRoute } from "@tanstack/react-router";

import { UsagePage } from "../components/usage/UsagePage";
import { METRIC_OPTIONS, type UsageMetric } from "../components/usage/usageShortcuts";

// Personal build: the view lives in the URL so the Usage sidebar (Limits,
// Spend) and the page share it.
export interface UsageSearch {
  /** Selected view. Absent falls back to the saved preference. */
  readonly metric?: UsageMetric;
  /** Provider tab under Limits, by driver kind. Absent opens the tightest provider. */
  readonly provider?: string;
}

export const Route = createFileRoute("/_chat/usage")({
  validateSearch: (raw: Record<string, unknown>): UsageSearch => ({
    ...(METRIC_OPTIONS.some((option) => option.value === raw.metric)
      ? { metric: raw.metric as UsageMetric }
      : {}),
    ...(raw.metric === "limits" && typeof raw.provider === "string" && raw.provider
      ? { provider: raw.provider }
      : {}),
  }),
  component: UsageRoute,
});

function UsageRoute() {
  const { metric, provider } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <UsagePage
      {...(metric ? { metric } : {})}
      {...(provider ? { provider } : {})}
      onViewChange={(next, nextProvider) =>
        void navigate({
          search: { metric: next, ...(nextProvider ? { provider: nextProvider } : {}) },
        })
      }
    />
  );
}
