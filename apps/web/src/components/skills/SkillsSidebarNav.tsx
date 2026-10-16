import type { ProviderDriverKind } from "@t3tools/contracts";
import { UserIcon } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { useProjects } from "../../state/entities";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { PageSidebarNav, type PageSidebarSection } from "../sidebar/PageSidebarNav";
import { SkillsIcon } from "./SkillsIcon";
import { useSkillsEnvironments } from "./SkillsPage";
import {
  collectSkillEntries,
  formatSkillsView,
  parseSkillsView,
  type SkillsView,
} from "./skillsCatalog";

// The Skills page's views: everything, personal skills, one provider, or one
// project. The selected view lives in the URL (?view=).
export function SkillsSidebarNav() {
  const navigate = useNavigate();
  // The sidebar can render a frame apart from the page, so it must not require the match.
  const view = parseSkillsView(useSearch({ from: "/skills", shouldThrow: false })?.view);
  const selected = formatSkillsView(view);
  const environments = useSkillsEnvironments();
  const projects = useProjects();
  const select = (next: SkillsView) =>
    void navigate({ to: "/skills", search: { view: formatSkillsView(next) } });

  const byInstance = new Map<string, { name: string; driver: ProviderDriverKind }>();
  for (const entry of collectSkillEntries(environments)) {
    if (!byInstance.has(entry.instanceId)) {
      byInstance.set(entry.instanceId, { name: entry.providerName, driver: entry.driver });
    }
  }
  const providers = [...byInstance].toSorted(([, left], [, right]) =>
    left.name.localeCompare(right.name),
  );
  const multipleEnvironments = environments.length > 1;
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );

  const sections: PageSidebarSection[] = [
    {
      items: [
        { id: "all", label: "All skills", icon: SkillsIcon, view: { kind: "all" } as const },
        { id: "personal", label: "Personal", icon: UserIcon, view: { kind: "personal" } as const },
      ].map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        active: selected === formatSkillsView(item.view),
        onSelect: () => select(item.view),
      })),
    },
  ];
  if (providers.length > 0) {
    sections.push({
      label: "Providers",
      items: providers.map(([instanceId, provider]) => {
        const next: SkillsView = { kind: "provider", instanceId };
        return {
          id: `provider-${instanceId}`,
          label: provider.name,
          icon: (
            <ProviderInstanceIcon
              driverKind={provider.driver}
              displayName={provider.name}
              className="size-4"
              iconClassName="size-4"
            />
          ),
          active: selected === formatSkillsView(next),
          onSelect: () => select(next),
        };
      }),
    });
  }
  const connectedProjects = projects
    .filter((project) => environmentLabels.has(project.environmentId))
    .toSorted((left, right) => left.title.localeCompare(right.title));
  if (connectedProjects.length > 0) {
    sections.push({
      label: "Projects",
      items: connectedProjects.map((project) => {
        const next: SkillsView = {
          kind: "project",
          environmentId: project.environmentId,
          cwd: project.workspaceRoot,
        };
        return {
          id: `project-${project.environmentId}-${project.id}`,
          label: multipleEnvironments
            ? `${project.title} · ${environmentLabels.get(project.environmentId)}`
            : project.title,
          icon: <ProjectFavicon project={project} className="size-4" />,
          active: selected === formatSkillsView(next),
          onSelect: () => select(next),
        };
      }),
    });
  }
  return <PageSidebarNav sections={sections} />;
}
