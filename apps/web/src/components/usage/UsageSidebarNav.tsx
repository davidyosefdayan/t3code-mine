import { CoinsIcon, GaugeIcon } from "lucide-react";
import { useLocation, useRouter } from "@tanstack/react-router";

import { PageSidebarNav } from "../sidebar/PageSidebarNav";
import { readUsagePagePreferences, rememberUsageView } from "./usagePagePreferences";

type UsageView = "limits" | "cost" | "tokens";

function isUsageView(value: unknown): value is UsageView {
  return value === "limits" || value === "cost" || value === "tokens";
}

// Personal build: the Usage page's two views, Limits (what is left) and Spend
// (API-equivalent cost and tokens). The selection lives in the URL (?metric=),
// read loosely so the sidebar can render a frame apart from the page.
export function UsageSidebarNav() {
  const router = useRouter();
  const saved = readUsagePagePreferences();
  const searchMetric = useLocation({
    select: (location) => (location.search as { readonly metric?: unknown }).metric,
  });
  const metric = isUsageView(searchMetric) ? searchMetric : saved.metric;
  const onLimits = metric === "limits";
  const show = (view: UsageView) => {
    rememberUsageView(view);
    void router.navigate({ href: `/usage?metric=${view}` });
  };
  return (
    <PageSidebarNav
      sections={[
        {
          items: [
            {
              id: "limits",
              label: "Limits",
              icon: GaugeIcon,
              active: onLimits,
              onSelect: () => show("limits"),
            },
            {
              id: "spend",
              label: "Spend",
              icon: CoinsIcon,
              active: !onLimits,
              onSelect: () => show(saved.spendMetric ?? "cost"),
            },
          ],
        },
      ]}
    />
  );
}
