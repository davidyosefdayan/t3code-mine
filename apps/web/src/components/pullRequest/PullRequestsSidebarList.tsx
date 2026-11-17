import type { ReactNode, RefObject } from "react";

import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { ListSearchBar, type ListFilterChip } from "../page/ListSearchBar";
import { SidebarListLayout } from "../page/SidebarListLayout";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { RefreshIcon } from "../ui/refresh-icon";

/**
 * Personal build: the pull request list drawn in the page's sidebar, like the
 * thread list: one search bar (sort and filters at its end, the filters that
 * are on as chips under it), then the rows.
 */
export function PullRequestsSidebarList({
  scrollRef,
  ...props
}: {
  searchBar: {
    value: string;
    busy: boolean;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
  };
  filterChips: ReadonlyArray<ListFilterChip>;
  onClearFilters: () => void;
  sortMenu: ReactNode;
  filtersMenu: ReactNode;
  listBody: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      {...workspaceAreaProps("pull-requests", 1, "Pull requests")}
      className="@container/pr-list flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <SidebarListLayout
        scrollRef={scrollRef}
        header={
          <ListSearchBar
            {...props.searchBar}
            placeholder="Search, or label:bug"
            ariaLabel="Search pull requests"
            actions={
              <>
                {props.sortMenu}
                {props.filtersMenu}
                <SidebarHeaderIconButton
                  label="Refresh pull requests"
                  onClick={props.onRefresh}
                  disabled={props.refreshing}
                >
                  <RefreshIcon size="sm" refreshing={props.refreshing} />
                </SidebarHeaderIconButton>
              </>
            }
            chips={props.filterChips}
            onClearChips={props.onClearFilters}
          />
        }
      >
        {props.listBody}
      </SidebarListLayout>
    </div>
  );
}
