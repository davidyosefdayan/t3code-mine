import { useGT } from "gt-react";
import type { ReactNode } from "react";

import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { ListSearchBar, type ListFilterChip } from "../page/ListSearchBar";
import { SidebarListLayout } from "../page/SidebarListLayout";

/**
 * Personal build: the issue list drawn in the Issues sidebar, like Pull requests:
 * one search bar (sort and filters at its end, the filters that are on as chips
 * under it), then the rows.
 */
export function IssuesSidebarList(props: {
  searchBar: {
    value: string;
    busy: boolean;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
  };
  filterChips: ReadonlyArray<ListFilterChip>;
  onClearFilters: () => void;
  actions: ReactNode;
  listBody: ReactNode;
}) {
  const gt = useGT();
  return (
    <div
      {...workspaceAreaProps("issues", 1, gt("Issues"))}
      className="@container/issue-list flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <SidebarListLayout
        header={
          <ListSearchBar
            {...props.searchBar}
            placeholder={gt("Search issues")}
            ariaLabel={gt("Search issues")}
            actions={props.actions}
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
