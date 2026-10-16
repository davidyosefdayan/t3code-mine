import type { EnvironmentId, ServerProvider, ServerProviderSkill } from "@t3tools/contracts";
import { resolveProviderSkillSourceKind } from "@t3tools/client-runtime/providerSkills";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import { normalizeSearchQuery } from "@t3tools/shared/searchRanking";

import { scoreProviderSkill } from "../../providerSkillSearch";

/** Where a skill comes from, as the Skills page groups and labels it. */
export type SkillSource = "personal" | "project" | "plugin" | "system";

export interface SkillEntry {
  /** Unique across environments and providers. */
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ServerProvider["instanceId"];
  readonly driver: ServerProvider["driver"];
  readonly providerName: string;
  readonly accentColor: string | undefined;
  readonly skill: ServerProviderSkill;
  readonly displayName: string;
  readonly source: SkillSource;
  /** The project folder whose scan reported it; null for the provider's own list. */
  readonly projectCwd: string | null;
}

export interface SkillsEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly providers: ReadonlyArray<ServerProvider>;
}

/**
 * The Skills page's selected view, kept in the URL so the page sidebar and the
 * page agree: everything, personal skills, one provider, or one project.
 */
export type SkillsView =
  | { readonly kind: "all" }
  | { readonly kind: "personal" }
  | { readonly kind: "provider"; readonly instanceId: string }
  | {
      readonly kind: "project";
      readonly environmentId: EnvironmentId;
      readonly cwd: string;
    };

export function parseSkillsView(raw: unknown): SkillsView {
  if (typeof raw !== "string" || raw === "all") return { kind: "all" };
  if (raw === "personal") return { kind: "personal" };
  if (raw.startsWith("provider:")) {
    const instanceId = raw.slice("provider:".length);
    if (instanceId) return { kind: "provider", instanceId };
  }
  if (raw.startsWith("project:")) {
    const rest = raw.slice("project:".length);
    const separator = rest.indexOf(":");
    if (separator > 0 && separator < rest.length - 1) {
      return {
        kind: "project",
        environmentId: rest.slice(0, separator) as EnvironmentId,
        cwd: rest.slice(separator + 1),
      };
    }
  }
  return { kind: "all" };
}

export function formatSkillsView(view: SkillsView): string {
  switch (view.kind) {
    case "all":
    case "personal":
      return view.kind;
    case "provider":
      return `provider:${view.instanceId}`;
    case "project":
      return `project:${view.environmentId}:${view.cwd}`;
  }
}

function sourceOf(skill: ServerProviderSkill, fromProjectScan: boolean): SkillSource {
  switch (resolveProviderSkillSourceKind(skill)) {
    case "app":
      return "plugin";
    case "system":
      return "system";
    case "repo":
    case "project":
      return "project";
    case "personal":
      return "personal";
    case "other":
      return fromProjectScan ? "project" : "personal";
  }
}

/**
 * Every skill each connected environment's providers report: the provider's
 * own list plus anything only a project scan found. A skill both lists report
 * (a personal skill shows up in every project scan) appears once.
 */
export function collectSkillEntries(
  environments: ReadonlyArray<SkillsEnvironmentInput>,
): SkillEntry[] {
  const entries: SkillEntry[] = [];
  for (const environment of environments) {
    for (const provider of environment.providers) {
      if (!provider.enabled) continue;
      const providerName = resolveProviderInstanceDisplayName(provider);
      const seenPaths = new Set<string>();
      const add = (skill: ServerProviderSkill, projectCwd: string | null) => {
        if (seenPaths.has(skill.path)) return;
        seenPaths.add(skill.path);
        entries.push({
          key: `${environment.environmentId}\u0000${provider.instanceId}\u0000${skill.path}`,
          environmentId: environment.environmentId,
          environmentLabel: environment.label,
          instanceId: provider.instanceId,
          driver: provider.driver,
          providerName,
          accentColor: provider.accentColor,
          skill,
          displayName: formatProviderSkillDisplayName(skill),
          source: sourceOf(skill, projectCwd !== null),
          projectCwd,
        });
      };
      for (const skill of provider.skills) add(skill, null);
      for (const snapshot of provider.workspaceSnapshots ?? []) {
        for (const skill of snapshot.skills) add(skill, snapshot.cwd);
      }
    }
  }
  return entries;
}

function isUnderDirectory(filePath: string, directory: string): boolean {
  const normalizedFile = filePath.replaceAll("\\", "/");
  const normalizedDirectory = directory.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalizedFile.startsWith(`${normalizedDirectory}/`);
}

export function filterSkillEntriesForView(
  entries: ReadonlyArray<SkillEntry>,
  view: SkillsView,
): SkillEntry[] {
  switch (view.kind) {
    case "all":
      return [...entries];
    case "personal":
      return entries.filter((entry) => entry.source === "personal");
    case "provider":
      return entries.filter((entry) => entry.instanceId === view.instanceId);
    case "project":
      // A project's skills are the ones stored inside it. Skills the scan also
      // reported from elsewhere (personal, plugins) already have their own views.
      return entries.filter(
        (entry) =>
          entry.environmentId === view.environmentId &&
          isUnderDirectory(entry.skill.path, view.cwd),
      );
  }
}

/** Search across names, descriptions and scope, best match first. */
export function searchSkillEntries(
  entries: ReadonlyArray<SkillEntry>,
  query: string,
): SkillEntry[] {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^[/$]+/u });
  if (!normalizedQuery) return [...entries];
  const scored: Array<{ entry: SkillEntry; score: number }> = [];
  for (const entry of entries) {
    const score = scoreProviderSkill(entry.skill, normalizedQuery);
    if (score !== null) scored.push({ entry, score });
  }
  return scored
    .toSorted(
      (left, right) =>
        left.score - right.score || left.entry.displayName.localeCompare(right.entry.displayName),
    )
    .map(({ entry }) => entry);
}

export interface SkillGroup {
  readonly key: string;
  readonly label: string;
  readonly entries: ReadonlyArray<SkillEntry>;
}

/**
 * Groups by provider, alphabetical inside each group. With more than one
 * environment, groups carry the environment's name so two machines' Claude
 * skills never blend. `keepOrder` preserves search ranking inside groups.
 */
export function groupSkillEntries(
  entries: ReadonlyArray<SkillEntry>,
  options?: { readonly keepOrder?: boolean },
): SkillGroup[] {
  const multipleEnvironments = new Set(entries.map((entry) => entry.environmentId)).size > 1;
  const groups = new Map<string, { label: string; entries: SkillEntry[] }>();
  for (const entry of entries) {
    const key = `${entry.environmentId}\u0000${entry.instanceId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        label: multipleEnvironments
          ? `${entry.providerName} · ${entry.environmentLabel}`
          : entry.providerName,
        entries: [],
      };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups]
    .map(([key, group]) => ({
      key,
      label: group.label,
      entries: options?.keepOrder
        ? group.entries
        : group.entries.toSorted((left, right) =>
            left.displayName.localeCompare(right.displayName),
          ),
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

/** The skill's folder: the directory holding its SKILL.md. */
export function skillDirectory(skillPath: string): string {
  const lastSeparator = Math.max(skillPath.lastIndexOf("/"), skillPath.lastIndexOf("\\"));
  return lastSeparator > 0 ? skillPath.slice(0, lastSeparator) : skillPath;
}

const FRONTMATTER_PATTERN = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** SKILL.md without its YAML frontmatter, which the page shows as metadata instead. */
export function stripSkillFrontmatter(contents: string): string {
  return contents.replace(FRONTMATTER_PATTERN, "").replace(/^\s+/, "");
}

/** How a skill can be started, when it is not the usual "you or the agent". */
export function skillInvocationLabel(skill: ServerProviderSkill): string | null {
  if (skill.userInvocable === false) return "Agent only";
  if (skill.userInvocationOnly) return "You only";
  return null;
}

/** Providers whose skills T3 Code can create, switch off, and share (see SkillLibrary). */
const MANAGEABLE_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);

export function isSkillManageable(driver: string): boolean {
  return MANAGEABLE_DRIVERS.has(driver);
}

const DEFAULT_PERSONAL_ROOTS: Readonly<Record<string, string>> = {
  claudeAgent: "~/.claude/skills",
  codex: "~/.codex/skills",
};

/**
 * Where a provider keeps personal skills, read off the skills it already
 * reports (a folder of skill folders), else the provider's usual folder.
 */
export function personalSkillsRoot(
  entries: ReadonlyArray<SkillEntry>,
  target: { readonly instanceId: string; readonly driver: string },
): string | null {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.instanceId !== target.instanceId || entry.source !== "personal") continue;
    const root = skillDirectory(skillDirectory(entry.skill.path));
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  const [best] = [...counts].toSorted((left, right) => right[1] - left[1]);
  return best?.[0] ?? DEFAULT_PERSONAL_ROOTS[target.driver] ?? null;
}

/** Turns typed text into a skill name: lowercase words joined by hyphens. */
export function toSkillName(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * The opening message for building a skill with an agent. It asks first, then
 * writes one folder and links it for every other provider, the same layout
 * the Skills page creates.
 */
export function buildCreateSkillPrompt(
  targets: ReadonlyArray<{ readonly providerName: string; readonly root: string }>,
): string {
  const [home, ...others] = targets;
  const lines = [
    "Help me create a new agent skill. Use your skill-creator skill if you have one.",
    "Start by asking me what the skill should do and when it should be used. Don't write anything until we agree on it.",
  ];
  if (home) {
    lines.push(
      "",
      `When it's ready, save it as one folder with a SKILL.md (name and description in YAML frontmatter) in ${home.root}/<name>/ for ${home.providerName}.`,
    );
    for (const other of others) {
      lines.push(
        `Make it available to ${other.providerName} too by symlinking ${other.root}/<name> to that folder, so there is only one copy to maintain.`,
      );
    }
  }
  return lines.join("\n");
}

/** The opening message for changing a skill with an agent; the user finishes it. */
export function buildEditSkillPrompt(skillPath: string): string {
  return `Edit the skill at ${skillPath}. Keep its name and frontmatter valid. Here's what I want to change: `;
}
