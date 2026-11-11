// Personal build: the pull request filters that are on, as removable chips
// under the sidebar search bar.
import type { ListFilterChip } from "../page/ListSearchBar";
import type { PullRequestListPreferencePatch } from "./pullRequestListPreferences";
import { INVOLVEMENT_TABS, STATE_TABS } from "./pullRequestListOptions";
import type { PullRequestsSearch } from "./usePullRequestListView";

const DRAFT_LABEL: Record<string, string> = { only: "Drafts only", hide: "No drafts" };
const REVIEW_LABEL: Record<string, string> = {
  approved: "Approved",
  "changes-requested": "Changes requested",
  "review-required": "Review required",
  none: "No reviews",
};
const CHECKS_LABEL: Record<string, string> = { passing: "Checks passing", failing: "Checks failing" };

export function pullRequestFilterChips(
  search: PullRequestsSearch,
  scope: { readonly projectTitle?: string | undefined; readonly serverLabel?: string | undefined },
  update: (patch: PullRequestListPreferencePatch) => void,
): ListFilterChip[] {
  const chips: ListFilterChip[] = [];
  if (search.state !== "open") {
    chips.push({
      key: "state",
      label:
        search.state === "all"
          ? "Any state"
          : (STATE_TABS.find((tab) => tab.value === search.state)?.label ?? search.state),
      onRemove: () => update({ state: "open" }),
    });
  }
  if (search.involvement !== "all") {
    chips.push({
      key: "involvement",
      label:
        INVOLVEMENT_TABS.find((tab) => tab.value === search.involvement)?.label ??
        search.involvement,
      onRemove: () => update({ involvement: "all" }),
    });
  }
  if (scope.projectTitle) {
    chips.push({
      key: "project",
      label: scope.projectTitle,
      onRemove: () => update({ projectId: undefined }),
    });
  }
  if (scope.serverLabel) {
    chips.push({
      key: "server",
      label: scope.serverLabel,
      onRemove: () => update({ environmentId: undefined, projectId: undefined }),
    });
  }
  if (search.host) {
    chips.push({ key: "host", label: search.host, onRemove: () => update({ host: undefined }) });
  }
  if (search.author) {
    chips.push({
      key: "author",
      label: `by ${search.author}`,
      onRemove: () => update({ author: undefined }),
    });
  }
  for (const label of search.labels ?? []) {
    chips.push({
      key: `label:${label}`,
      label,
      onRemove: () => update({ labels: (search.labels ?? []).filter((entry) => entry !== label) }),
    });
  }
  if (search.draft) {
    chips.push({
      key: "draft",
      label: DRAFT_LABEL[search.draft] ?? search.draft,
      onRemove: () => update({ draft: undefined }),
    });
  }
  if (search.review) {
    chips.push({
      key: "review",
      label: REVIEW_LABEL[search.review] ?? search.review,
      onRemove: () => update({ review: undefined }),
    });
  }
  if (search.checks) {
    chips.push({
      key: "checks",
      label: CHECKS_LABEL[search.checks] ?? search.checks,
      onRemove: () => update({ checks: undefined }),
    });
  }
  return chips;
}
