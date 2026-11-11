import { createFileRoute } from "@tanstack/react-router";

import { UsagePage } from "../components/usage/UsagePage";

// Personal build: the page lives in the URL so the Usage sidebar (All
// providers, then one page per provider) and the page share it.
export interface UsageSearch {
  /** A provider's driver kind, or `all`. Absent falls back to the saved page. */
  readonly provider?: string;
  /** The unit charts show. Absent falls back to the saved unit. */
  readonly metric?: "cost" | "tokens";
}

export const Route = createFileRoute("/_chat/usage")({
  validateSearch: (raw: Record<string, unknown>): UsageSearch => ({
    ...(typeof raw.provider === "string" && raw.provider ? { provider: raw.provider } : {}),
    ...(raw.metric === "cost" || raw.metric === "tokens" ? { metric: raw.metric } : {}),
  }),
  component: UsageRoute,
});

function UsageRoute() {
  const { provider, metric } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <UsagePage
      {...(provider ? { view: provider } : {})}
      {...(metric ? { unit: metric } : {})}
      onNavigate={(next) =>
        void navigate({
          search: { provider: next.view, ...(next.unit ? { metric: next.unit } : {}) },
        })
      }
    />
  );
}
