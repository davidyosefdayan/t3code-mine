import type { PullRequestInvolvement, PullRequestListState } from "@t3tools/contracts";
import { EyeIcon, InboxIcon, PenLineIcon } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import type { PullRequestsSearch } from "../../routes/_chat.pull-requests";
import { PageSidebarNav } from "../sidebar/PageSidebarNav";
import { PullRequestGlyph } from "./pullRequestIcons";

const INVOLVEMENT = [
  { value: "all", label: "All", icon: InboxIcon },
  { value: "authored", label: "Authored", icon: PenLineIcon },
  { value: "reviewing", label: "Reviewing", icon: EyeIcon },
] as const satisfies ReadonlyArray<{ value: PullRequestInvolvement; label: string; icon: unknown }>;

const STATES = [
  { value: "open", label: "Open", icon: PullRequestGlyph.pullRequest },
  { value: "merged", label: "Merged", icon: PullRequestGlyph.merged },
  { value: "closed", label: "Closed", icon: PullRequestGlyph.closed },
  { value: "all", label: "All states", icon: PullRequestGlyph.stack },
] as const satisfies ReadonlyArray<{ value: PullRequestListState; label: string; icon: unknown }>;

// The page's own list filters (already URL search params), as sidebar views.
export function PullRequestsSidebarNav() {
  const navigate = useNavigate({ from: "/pull-requests" });
  // The sidebar can render a frame before or after the page during a switch,
  // so it must not require the page's match.
  const search = useSearch({ from: "/_chat/pull-requests", shouldThrow: false });
  const update = (patch: Partial<PullRequestsSearch>) =>
    void navigate({
      search: (previous: PullRequestsSearch): PullRequestsSearch => ({ ...previous, ...patch }),
    });
  return (
    <PageSidebarNav
      sections={[
        {
          label: "Involvement",
          items: INVOLVEMENT.map((option) => ({
            id: `involvement-${option.value}`,
            label: option.label,
            icon: option.icon,
            active: search?.involvement === option.value,
            onSelect: () => update({ involvement: option.value }),
          })),
        },
        {
          label: "State",
          items: STATES.map((option) => ({
            id: `state-${option.value}`,
            label: option.label,
            icon: option.icon,
            active: search?.state === option.value,
            onSelect: () => update({ state: option.value }),
          })),
        },
      ]}
    />
  );
}
