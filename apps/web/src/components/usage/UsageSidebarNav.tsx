import { useAtomValue } from "@effect/atom-react";
import { ProviderDriverKind } from "@t3tools/contracts";
import { useLocation, useRouter } from "@tanstack/react-router";
import { LayoutGridIcon } from "lucide-react";

import { environmentPresentations } from "../../state/presentation";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { PageSidebarNav } from "../sidebar/PageSidebarNav";
import { readUsagePagePreferences, rememberUsagePage } from "./usagePagePreferences";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "./usageProviders";
import { useUsageLimitSummaries } from "./UsageRailIcon";

const PAGE_ORDER: readonly string[] = [
  PROVIDER_PRESENTATION.claude.driverKind,
  PROVIDER_PRESENTATION.codex.driverKind,
  ...PROVIDER_ORDER.map((kind) => PROVIDER_PRESENTATION[kind].driverKind),
];

// Personal build: the Usage page's sidebar. All providers, then a page per
// provider you have, each with its weekly limit left. The page lives in the
// URL (?provider=), read loosely so the sidebar can render apart from the page.
export function UsageSidebarNav() {
  const router = useRouter();
  const searchProvider = useLocation({
    select: (location) => (location.search as { readonly provider?: unknown }).provider,
  });
  const current =
    typeof searchProvider === "string" && searchProvider
      ? searchProvider
      : (readUsagePagePreferences().provider ?? "all");
  const summaries = useUsageLimitSummaries();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const installed = new Set<string>(
    [...presentations.values()].flatMap((presentation) =>
      (presentation.serverConfig?.providers ?? [])
        .filter((provider) => provider.enabled && provider.installed)
        .map((provider) => provider.driver),
    ),
  );
  for (const summary of summaries) installed.add(summary.driver);
  const drivers = PAGE_ORDER.filter(
    (driver, index) => installed.has(driver) && PAGE_ORDER.indexOf(driver) === index,
  );
  const show = (view: string) => {
    rememberUsagePage(view);
    void router.navigate({ href: `/usage?provider=${encodeURIComponent(view)}` });
  };
  return (
    <PageSidebarNav
      sections={[
        {
          items: [
            {
              id: "all",
              label: "All providers",
              icon: LayoutGridIcon,
              active: current === "all",
              onSelect: () => show("all"),
            },
            ...drivers.map((driver) => {
              const label =
                Object.values(PROVIDER_PRESENTATION).find((entry) => entry.driverKind === driver)
                  ?.label ?? driver;
              const summary = summaries.find((entry) => entry.driver === driver);
              return {
                id: driver,
                label,
                icon: (
                  <ProviderInstanceIcon
                    driverKind={ProviderDriverKind.make(driver)}
                    displayName={label}
                    className="size-4"
                    iconClassName="size-4"
                  />
                ),
                active: current === driver,
                onSelect: () => show(driver),
                ...(summary ? { trailing: `${summary.remainingPercent}% left` } : {}),
              };
            }),
          ],
        },
      ]}
    />
  );
}
