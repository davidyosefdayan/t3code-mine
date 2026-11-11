import { createFileRoute, redirect } from "@tanstack/react-router";

import { SkillsPage } from "../components/skills/SkillsPage";
import { parseSkillsView } from "../components/skills/skillsCatalog";

// Personal build: the Skills page.
export interface SkillsSearch {
  /** Selected view (see SkillsView). Absent means every skill. */
  readonly view?: string;
  /** The open skill's key. Absent shows the first in the view. */
  readonly skill?: string;
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
  validateSearch: (raw: Record<string, unknown>): SkillsSearch => ({
    ...(typeof raw.view === "string" && raw.view !== "all" ? { view: raw.view } : {}),
    ...(typeof raw.skill === "string" && raw.skill ? { skill: raw.skill } : {}),
  }),
  component: SkillsRoute,
});

// The view and the open skill live in the URL so the Skills sidebar (the
// list) and the page (the skill) share them.
function SkillsRoute() {
  const { view, skill } = Route.useSearch();
  return <SkillsPage view={parseSkillsView(view)} selectedKey={skill ?? null} />;
}
