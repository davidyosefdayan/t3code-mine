import type { EnvironmentId, ServerProvider, ServerProviderSkill } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildCreateSkillPrompt,
  collectSkillEntries,
  filterSkillEntriesForView,
  formatSkillsView,
  groupSkillEntries,
  parseSkillsView,
  personalSkillsRoot,
  searchSkillEntries,
  stripSkillFrontmatter,
  toSkillName,
} from "./skillsCatalog";

const LOCAL = "env-local" as EnvironmentId;
const REMOTE = "env-remote" as EnvironmentId;

function skill(name: string, path: string, extra?: Partial<ServerProviderSkill>) {
  return { name, path, enabled: true, ...extra } as ServerProviderSkill;
}

function provider(input: {
  instanceId: string;
  driver: string;
  skills: ServerProviderSkill[];
  workspaceSnapshots?: Array<{ cwd: string; skills: ServerProviderSkill[] }>;
  enabled?: boolean;
}): ServerProvider {
  return {
    instanceId: input.instanceId,
    driver: input.driver,
    enabled: input.enabled ?? true,
    skills: input.skills,
    workspaceSnapshots: input.workspaceSnapshots?.map((snapshot) => ({
      ...snapshot,
      checkedAt: "2026-10-07T00:00:00.000Z",
      slashCommands: [],
    })),
  } as unknown as ServerProvider;
}

const personal = skill("review", "/home/me/.claude/skills/review/SKILL.md", { scope: "user" });
const projectSkill = skill("deploy", "/work/app/.claude/skills/deploy/SKILL.md", {
  scope: "project",
});

describe("collectSkillEntries", () => {
  it("lists a skill reported by both the provider and a project scan once", () => {
    const entries = collectSkillEntries([
      {
        environmentId: LOCAL,
        label: "This Mac",
        providers: [
          provider({
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            skills: [personal],
            workspaceSnapshots: [{ cwd: "/work/app", skills: [personal, projectSkill] }],
          }),
        ],
      },
    ]);
    expect(entries.map((entry) => [entry.skill.name, entry.source, entry.projectCwd])).toEqual([
      ["review", "personal", null],
      ["deploy", "project", "/work/app"],
    ]);
  });

  it("skips disabled providers", () => {
    const entries = collectSkillEntries([
      {
        environmentId: LOCAL,
        label: "This Mac",
        providers: [
          provider({ instanceId: "codex", driver: "codex", skills: [personal], enabled: false }),
        ],
      },
    ]);
    expect(entries).toEqual([]);
  });
});

describe("filterSkillEntriesForView", () => {
  const entries = collectSkillEntries([
    {
      environmentId: LOCAL,
      label: "This Mac",
      providers: [
        provider({
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          skills: [personal],
          workspaceSnapshots: [{ cwd: "/work/app", skills: [projectSkill] }],
        }),
      ],
    },
    {
      environmentId: REMOTE,
      label: "Server",
      providers: [
        provider({
          instanceId: "codex",
          driver: "codex",
          skills: [skill("lint", "/srv/.codex/skills/lint/SKILL.md", { scope: "user" })],
        }),
      ],
    },
  ]);

  it("narrows to personal skills, one provider, or one project", () => {
    const names = (view: Parameters<typeof filterSkillEntriesForView>[1]) =>
      filterSkillEntriesForView(entries, view).map((entry) => entry.skill.name);
    expect(names({ kind: "all" })).toEqual(["review", "deploy", "lint"]);
    expect(names({ kind: "personal" })).toEqual(["review", "lint"]);
    expect(names({ kind: "provider", instanceId: "codex" })).toEqual(["lint"]);
    expect(names({ kind: "project", environmentId: LOCAL, cwd: "/work/app/" })).toEqual(["deploy"]);
    expect(names({ kind: "project", environmentId: REMOTE, cwd: "/work/app" })).toEqual([]);
  });

  it("names groups after their machine when skills come from more than one", () => {
    expect(groupSkillEntries(entries).map((group) => group.label)).toEqual([
      "Claude · This Mac",
      "Codex · Server",
    ]);
  });
});

describe("skills view in the URL", () => {
  it("round-trips every view, including project paths with colons", () => {
    const views = [
      { kind: "all" },
      { kind: "personal" },
      { kind: "provider", instanceId: "codex_personal" },
      { kind: "project", environmentId: LOCAL, cwd: "C:/work/app" },
    ] as const;
    for (const view of views) {
      expect(parseSkillsView(formatSkillsView(view))).toEqual(view);
    }
  });

  it("falls back to all skills for anything it does not recognize", () => {
    expect(parseSkillsView("provider:")).toEqual({ kind: "all" });
    expect(parseSkillsView(42)).toEqual({ kind: "all" });
  });
});

describe("searchSkillEntries", () => {
  it("matches a typed slash command and ranks name matches first", () => {
    const entries = collectSkillEntries([
      {
        environmentId: LOCAL,
        label: "This Mac",
        providers: [
          provider({
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            skills: [
              skill("notes", "/s/notes/SKILL.md", { description: "Review meeting notes" }),
              personal,
            ],
          }),
        ],
      },
    ]);
    expect(searchSkillEntries(entries, "/review").map((entry) => entry.skill.name)).toEqual([
      "review",
      "notes",
    ]);
  });
});

describe("stripSkillFrontmatter", () => {
  it("drops the YAML header and keeps the body", () => {
    expect(stripSkillFrontmatter("---\nname: review\ndescription: x\n---\n\n# Review\n")).toBe(
      "# Review\n",
    );
    expect(stripSkillFrontmatter("# No header")).toBe("# No header");
  });
});

describe("skill authoring helpers", () => {
  it("names skills the way providers expect", () => {
    expect(toSkillName("Weekly Status Report!")).toBe("weekly-status-report");
    expect(toSkillName("  Café notes ")).toBe("cafe-notes");
  });

  it("finds a provider's personal folder from the skills it reports", () => {
    const entries = collectSkillEntries([
      {
        environmentId: LOCAL,
        label: "This Mac",
        providers: [
          provider({ instanceId: "claudeAgent", driver: "claudeAgent", skills: [personal] }),
        ],
      },
    ]);
    expect(personalSkillsRoot(entries, { instanceId: "claudeAgent", driver: "claudeAgent" })).toBe(
      "/home/me/.claude/skills",
    );
    expect(personalSkillsRoot(entries, { instanceId: "codex", driver: "codex" })).toBe(
      "~/.codex/skills",
    );
  });

  it("asks the agent for one copy plus links", () => {
    const prompt = buildCreateSkillPrompt([
      { providerName: "Codex", root: "~/.codex/skills" },
      { providerName: "Claude", root: "~/.claude/skills" },
    ]);
    expect(prompt).toContain("in ~/.codex/skills/<name>/ for Codex");
    expect(prompt).toContain("symlinking ~/.claude/skills/<name> to that folder");
  });
});
