// @effect-diagnostics nodeBuiltinImport:off - the test inspects real links on disk.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { applyClaudeSkillOverride } from "../provider/Drivers/ClaudeSkillLibrary.ts";
import type { ProviderInstance, ProviderSkillLibrary } from "@t3tools/provider-core/server/driver";
import { ProviderInstanceRegistry } from "../provider/ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { make, renderSkillFile, skillLinkTarget } from "./SkillLibrary.ts";

function instance(id: string, library: ProviderSkillLibrary): ProviderInstance {
  return {
    instanceId: ProviderInstanceId.make(id),
    driverKind: ProviderDriverKind.make(id),
    enabled: true,
    displayName: id,
    continuationIdentity: { driverKind: ProviderDriverKind.make(id), continuationKey: id },
    skillLibrary: library,
    snapshotForCwd: () => Effect.die("unused"),
    get orchestrationAdapter(): never {
      throw new Error("unused");
    },
    get snapshot(): never {
      throw new Error("unused");
    },
    get textGeneration(): never {
      throw new Error("unused");
    },
  };
}

const withLibrary = Effect.fn("SkillLibrary.test.withLibrary")(function* (
  options: { readonly scannedProject?: string } = {},
) {
  const home = yield* Effect.promise(() =>
    NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skills-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
  );
  const toggled: string[] = [];
  const scans: string[] = [];
  const scannedProject =
    options.scannedProject === undefined ? undefined : NodePath.join(home, options.scannedProject);
  const library = (folder: string, projectFolder: string): ProviderSkillLibrary => ({
    personalRoot: NodePath.join(home, folder, "skills"),
    projectFolder,
    setEnabled: ({ name, enabled }) =>
      Effect.sync(() => {
        toggled.push(`${folder}:${name}:${enabled}`);
      }),
  });
  const instances = [
    instance("codex", library(".codex", ".agents/skills")),
    instance("claudeAgent", library(".claude", ".claude/skills")),
  ];
  const skills = yield* make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ProviderInstanceRegistry)({
          getInstance: (id) =>
            Effect.succeed(instances.find((candidate) => candidate.instanceId === id)),
          listInstances: Effect.succeed(instances),
        }),
        Layer.mock(ProviderRegistry)({
          getProviders: Effect.succeed(
            scannedProject === undefined
              ? []
              : [
                  {
                    workspaceSnapshots: [{ cwd: scannedProject }],
                  } as unknown as ServerProvider,
                ],
          ),
          refreshInstance: () => Effect.succeed([]),
          refreshWorkspaceSnapshot: ({ instanceId, cwd, fresh }) =>
            Effect.sync(() => {
              scans.push(
                `${instanceId}:${NodePath.relative(home, cwd)}:${fresh ? "fresh" : "fill"}`,
              );
              return [];
            }),
        }),
      ),
    ),
    // Off macOS, delete removes rather than using the real Trash.
    Effect.provideService(HostProcess.Platform, "linux"),
  );
  return { home, skills, toggled, scans, scannedProject };
});

describe("SkillLibrary", () => {
  it.effect("creates one copy and links it for the other provider", () =>
    Effect.gen(function* () {
      const { home, skills } = yield* withLibrary();
      const { path } = yield* skills.create({
        name: "weekly-report",
        description: 'Weekly "status" reports',
        instructions: "Summarize the week.",
        instanceIds: [ProviderInstanceId.make("codex"), ProviderInstanceId.make("claudeAgent")],
      });
      assert.strictEqual(path, NodePath.join(home, ".codex/skills/weekly-report/SKILL.md"));
      const linked = NodePath.join(home, ".claude/skills/weekly-report");
      assert.isTrue((yield* Effect.promise(() => NodeFSP.lstat(linked))).isSymbolicLink());
      const throughLink = yield* Effect.promise(() =>
        NodeFSP.readFile(NodePath.join(linked, "SKILL.md"), "utf8"),
      );
      assert.include(throughLink, 'description: "Weekly \\"status\\" reports"');

      // An edit through either provider lands in the one copy.
      yield* skills.save({ path: NodePath.join(linked, "SKILL.md"), contents: "edited" });
      assert.strictEqual(yield* Effect.promise(() => NodeFSP.readFile(path, "utf8")), "edited");

      const duplicate = yield* skills
        .create({
          name: "weekly-report",
          description: "Again",
          instructions: "",
          instanceIds: [ProviderInstanceId.make("claudeAgent")],
        })
        .pipe(Effect.flip);
      assert.include(duplicate.message, "already exists");
    }).pipe(Effect.scoped),
  );

  it.effect("shares a skill later, and deleting the real folder removes its links", () =>
    Effect.gen(function* () {
      const { home, skills } = yield* withLibrary();
      const { path } = yield* skills.create({
        name: "lint",
        description: "Lint",
        instructions: "",
        instanceIds: [ProviderInstanceId.make("codex")],
      });
      yield* skills.share({ path, instanceId: ProviderInstanceId.make("claudeAgent") });
      const linked = NodePath.join(home, ".claude/skills/lint");
      assert.isTrue((yield* Effect.promise(() => NodeFSP.lstat(linked))).isSymbolicLink());

      yield* skills.delete({ path });
      const exists = (target: string) =>
        Effect.promise(() =>
          NodeFSP.lstat(target).then(
            () => true,
            () => false,
          ),
        );
      assert.isFalse(yield* exists(NodePath.dirname(path)));
      assert.isFalse(yield* exists(linked));
    }).pipe(Effect.scoped),
  );

  it.effect("deleting a link leaves the real folder alone", () =>
    Effect.gen(function* () {
      const { home, skills } = yield* withLibrary();
      const { path } = yield* skills.create({
        name: "notes",
        description: "Notes",
        instructions: "",
        instanceIds: [ProviderInstanceId.make("codex"), ProviderInstanceId.make("claudeAgent")],
      });
      yield* skills.delete({ path: NodePath.join(home, ".claude/skills/notes/SKILL.md") });
      assert.isTrue(
        yield* Effect.promise(() =>
          NodeFSP.access(path).then(
            () => true,
            () => false,
          ),
        ),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("deleting a project skill removes its project link and rescans the project", () =>
    Effect.gen(function* () {
      const { home, skills, scans, scannedProject } = yield* withLibrary({
        scannedProject: "app",
      });
      const projectRoot = scannedProject ?? "";
      const { path } = yield* skills.create({
        name: "deploy",
        description: "Deploy",
        instructions: "",
        instanceIds: [ProviderInstanceId.make("codex"), ProviderInstanceId.make("claudeAgent")],
        projectRoot,
      });
      assert.strictEqual(path, NodePath.join(home, "app/.agents/skills/deploy/SKILL.md"));
      scans.length = 0;

      yield* skills.delete({ path });
      const linkGone = yield* Effect.promise(() =>
        NodeFSP.lstat(NodePath.join(projectRoot, ".claude/skills/deploy")).then(
          () => false,
          () => true,
        ),
      );
      assert.isTrue(linkGone);
      // One fresh scan, then the other provider refills what it dropped.
      assert.deepStrictEqual(scans, ["codex:app:fresh", "claudeAgent:app:fill"]);
    }).pipe(Effect.scoped),
  );

  it.effect("turns a skill off through the provider's own switch", () =>
    Effect.gen(function* () {
      const { skills, toggled } = yield* withLibrary();
      yield* skills.setEnabled({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        path: "/x/review/SKILL.md",
        name: "review",
        enabled: false,
      });
      assert.deepStrictEqual(toggled, [".claude:review:false"]);
    }).pipe(Effect.scoped),
  );
});

describe("skill files", () => {
  it("writes frontmatter every provider reads", () => {
    assert.strictEqual(
      renderSkillFile({ name: "a", description: "Does a: b", instructions: " Steps \n" }),
      '---\nname: a\ndescription: "Does a: b"\n---\n\nSteps\n',
    );
  });

  it("links inside a project relatively, so clones keep working", () => {
    assert.strictEqual(
      skillLinkTarget({
        linkPath: "/repo/.claude/skills/deploy",
        canonicalDirectory: "/repo/.agents/skills/deploy",
        projectRoot: "/repo",
      }),
      "../../.agents/skills/deploy",
    );
    assert.strictEqual(
      skillLinkTarget({
        linkPath: "/home/.claude/skills/deploy",
        canonicalDirectory: "/home/.codex/skills/deploy",
        projectRoot: undefined,
      }),
      "/home/.codex/skills/deploy",
    );
  });
});

describe("applyClaudeSkillOverride", () => {
  it("switches a skill off and back on, keeping other settings", () => {
    const off = applyClaudeSkillOverride('{"model":"opus"}', "review", false);
    assert.deepStrictEqual(JSON.parse(off ?? ""), {
      model: "opus",
      skillOverrides: { review: "off" },
    });
    assert.deepStrictEqual(JSON.parse(applyClaudeSkillOverride(off ?? "", "review", true) ?? ""), {
      model: "opus",
    });
  });

  it("leaves other override values alone when turning a skill on", () => {
    const settings = '{"skillOverrides":{"review":"user-invocable-only"}}';
    assert.deepStrictEqual(JSON.parse(applyClaudeSkillOverride(settings, "review", true) ?? ""), {
      skillOverrides: { review: "user-invocable-only" },
    });
  });

  it("refuses to rewrite a settings file with comments", () => {
    assert.isNull(applyClaudeSkillOverride('{\n  // mine\n  "model": "opus"\n}', "x", false));
  });
});
