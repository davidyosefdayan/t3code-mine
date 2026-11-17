import { setIssuesSidebarSlot } from "./issuesSidebarSlot";

// Personal build: the Issues sidebar is the issue list, like Pull requests. The
// page draws the list here, and the open issue fills the page.
export function IssuesSidebarNav() {
  return <div ref={setIssuesSidebarSlot} className="flex min-h-0 min-w-0 flex-1 flex-col" />;
}
