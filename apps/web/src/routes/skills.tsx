import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo } from "react";

import { SkillsPage } from "../components/skills/SkillsPage";
import { parseSkillsView } from "../components/skills/skillsCatalog";

// Personal build: the Skills page.
export interface SkillsSearch {
  /** Selected view (see SkillsView). Absent means every skill. */
  readonly view?: string;
}

export const Route = createFileRoute("/skills")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: (raw: Record<string, unknown>): SkillsSearch =>
    typeof raw.view === "string" && raw.view !== "all" ? { view: raw.view } : {},
  component: SkillsRoute,
});

// The view lives in the URL so the Skills sidebar and the page share it.
function SkillsRoute() {
  const { view } = Route.useSearch();
  const parsed = useMemo(() => parseSkillsView(view), [view]);
  return <SkillsPage view={parsed} />;
}
