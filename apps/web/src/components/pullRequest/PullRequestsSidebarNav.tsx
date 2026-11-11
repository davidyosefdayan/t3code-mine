import { setPullRequestsSidebarSlot } from "./pullRequestsSidebarSlot";

// Personal build: the Pull requests sidebar is the pull request list, like the
// thread list on Threads. The page draws the list here (search, filters, rows),
// so its state stays with the page, and the open pull request fills the page.
export function PullRequestsSidebarNav() {
  return <div ref={setPullRequestsSidebarSlot} className="flex min-h-0 min-w-0 flex-1 flex-col" />;
}
