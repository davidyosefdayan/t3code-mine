/**
 * Personal build: SkillLibrary - managing skills from the Skills page.
 *
 * A skill is a folder holding a SKILL.md. Each provider reads skills from its
 * own folders (see `ProviderSkillLibrary`), so a skill meant for several
 * providers lives once, in the first provider's folder, and every other
 * provider gets a symbolic link to it. Editing it through any of them edits
 * the one copy. Project links are relative, so they survive a clone or move.
 *
 * Turning a skill off goes through each provider's own switch, so the
 * provider and T3 Code agree on what is off.
 *
 * @module skills/SkillLibrary
 */
// @effect-diagnostics nodeBuiltinImport:off - symlinks and lstat need the node API's exact semantics.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  SkillLibraryError,
  type ProviderInstanceId,
  type SkillCreateInput,
  type SkillCreateResult,
  type SkillDeleteInput,
  type SkillDeleteResult,
  type SkillSaveInput,
  type SkillSetEnabledInput,
  type SkillShareInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type { ProviderSkillLibrary } from "@t3tools/provider-core/server/driver";

import { ProviderInstanceRegistry } from "../provider/ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";

export class SkillLibrary extends Context.Service<
  SkillLibrary,
  {
    readonly create: (
      input: SkillCreateInput,
    ) => Effect.Effect<SkillCreateResult, SkillLibraryError>;
    readonly save: (input: SkillSaveInput) => Effect.Effect<void, SkillLibraryError>;
    readonly setEnabled: (input: SkillSetEnabledInput) => Effect.Effect<void, SkillLibraryError>;
    readonly share: (input: SkillShareInput) => Effect.Effect<void, SkillLibraryError>;
    readonly delete: (
      input: SkillDeleteInput,
    ) => Effect.Effect<SkillDeleteResult, SkillLibraryError>;
  }
>()("t3/skills/SkillLibrary") {}

const fileOperation = <A>(message: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new SkillLibraryError({ message, cause }) });

const pathExists = (target: string) =>
  Effect.promise(() =>
    NodeFSP.lstat(target).then(
      () => true,
      () => false,
    ),
  );

/** YAML frontmatter plus instructions, the shape every provider reads. */
export function renderSkillFile(input: {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}): string {
  // A JSON string is a valid YAML double-quoted scalar, so any description is safe.
  const body = input.instructions.trim();
  return `---\nname: ${input.name}\ndescription: ${JSON.stringify(input.description)}\n---\n${body ? `\n${body}\n` : ""}`;
}

function isInside(filePath: string, directory: string): boolean {
  const relative = NodePath.relative(directory, filePath);
  return relative.length > 0 && !relative.startsWith("..") && !NodePath.isAbsolute(relative);
}

/** The link to place at `linkPath`: relative inside a project, absolute otherwise. */
export function skillLinkTarget(input: {
  readonly linkPath: string;
  readonly canonicalDirectory: string;
  readonly projectRoot: string | undefined;
}): string {
  const insideProject =
    input.projectRoot !== undefined &&
    !NodePath.relative(input.projectRoot, input.canonicalDirectory).startsWith("..");
  return insideProject
    ? NodePath.relative(NodePath.dirname(input.linkPath), input.canonicalDirectory)
    : input.canonicalDirectory;
}

export const make = Effect.gen(function* () {
  const instances = yield* ProviderInstanceRegistry;
  const providers = yield* ProviderRegistry;
  const platform = yield* HostProcess.Platform;
  const homeDirectory = yield* HostProcess.HomeDirectory;

  // Windows only lets admins (or Developer Mode) create directory symlinks, so
  // it gets a junction instead, which must point at an absolute path.
  const linkSkill = (linkPath: string, canonicalDirectory: string, projectRoot?: string) =>
    platform === "win32"
      ? NodeFSP.symlink(canonicalDirectory, linkPath, "junction")
      : NodeFSP.symlink(
          skillLinkTarget({ linkPath, canonicalDirectory, projectRoot }),
          linkPath,
          "dir",
        );

  const libraryFor = Effect.fn("SkillLibrary.libraryFor")(function* (
    instanceId: ProviderInstanceId,
  ) {
    const instance = yield* instances.getInstance(instanceId);
    if (!instance?.skillLibrary) {
      return yield* new SkillLibraryError({
        message: `${instance?.displayName ?? instanceId} skills can't be managed from T3 Code yet.`,
      });
    }
    return { instance, library: instance.skillLibrary };
  });

  const rootFor = (library: ProviderSkillLibrary, projectRoot: string | undefined) =>
    projectRoot === undefined
      ? library.personalRoot
      : NodePath.join(projectRoot, library.projectFolder);

  /** Project folders with a published skill scan that contain `filePath`. */
  const scannedProjectsContaining = (filePath: string) =>
    Effect.map(providers.getProviders, (snapshots) => [
      ...new Set(
        snapshots.flatMap((provider) =>
          (provider.workspaceSnapshots ?? [])
            .map((snapshot) => snapshot.cwd)
            .filter((cwd) => isInside(filePath, cwd)),
        ),
      ),
    ]);

  /**
   * Republish skills after a change at `filePath`: every manageable
   * provider's own list, then each project whose scan includes that path.
   * A fresh project scan drops every other provider's scan of that project,
   * so the first provider scans fresh and the rest refill one at a time.
   */
  const refreshSkills = Effect.fn("SkillLibrary.refreshSkills")(function* (
    filePath: string,
    projectRoot?: string,
  ) {
    const all = yield* instances.listInstances;
    yield* Effect.forEach(
      all.filter((instance) => instance.skillLibrary !== undefined),
      (instance) => providers.refreshInstance(instance.instanceId),
      { concurrency: "unbounded", discard: true },
    );
    const projects = new Set(yield* scannedProjectsContaining(filePath));
    if (projectRoot !== undefined) projects.add(projectRoot);
    const scanners = all.filter((instance) => instance.enabled && instance.snapshotForCwd);
    for (const cwd of projects) {
      for (const [index, instance] of scanners.entries()) {
        yield* providers.refreshWorkspaceSnapshot({
          instanceId: instance.instanceId,
          cwd,
          fresh: index === 0,
        });
      }
    }
  });

  const create: SkillLibrary["Service"]["create"] = Effect.fn("SkillLibrary.create")(
    function* (input) {
      const targets = yield* Effect.forEach(input.instanceIds, libraryFor);
      const directories = [
        ...new Set(
          targets.map(({ library }) =>
            NodePath.join(rootFor(library, input.projectRoot), input.name),
          ),
        ),
      ];
      for (const directory of directories) {
        if (yield* pathExists(directory)) {
          return yield* new SkillLibraryError({
            message: `A skill named "${input.name}" already exists at ${directory}.`,
          });
        }
      }
      const [canonical, ...links] = directories as [string, ...string[]];
      const skillPath = NodePath.join(canonical, "SKILL.md");
      yield* fileOperation(`Could not create ${canonical}.`, async () => {
        await NodeFSP.mkdir(canonical, { recursive: true });
        await NodeFSP.writeFile(skillPath, renderSkillFile(input), { flag: "wx" });
      });
      for (const linkPath of links) {
        yield* fileOperation(`Could not link the skill into ${linkPath}.`, async () => {
          await NodeFSP.mkdir(NodePath.dirname(linkPath), { recursive: true });
          await linkSkill(linkPath, canonical, input.projectRoot);
        });
      }
      yield* refreshSkills(skillPath, input.projectRoot);
      return { path: skillPath };
    },
  );

  const save: SkillLibrary["Service"]["save"] = Effect.fn("SkillLibrary.save")(function* (input) {
    if (!(yield* pathExists(input.path))) {
      return yield* new SkillLibraryError({ message: `${input.path} no longer exists.` });
    }
    // A plain write follows links, so a shared skill's one copy changes.
    yield* fileOperation(`Could not save ${input.path}.`, () =>
      NodeFSP.writeFile(input.path, input.contents),
    );
    yield* refreshSkills(input.path);
  });

  const setEnabled: SkillLibrary["Service"]["setEnabled"] = Effect.fn("SkillLibrary.setEnabled")(
    function* (input) {
      const { library } = yield* libraryFor(input.instanceId);
      yield* library
        .setEnabled({ path: input.path, name: input.name, enabled: input.enabled })
        .pipe(Effect.mapError((cause) => new SkillLibraryError({ message: cause.detail, cause })));
      // The provider republished its own list; project scans carry the flag too.
      const projects = yield* scannedProjectsContaining(input.path);
      if (projects.length > 0) yield* refreshSkills(input.path);
    },
  );

  const share: SkillLibrary["Service"]["share"] = Effect.fn("SkillLibrary.share")(
    function* (input) {
      const { library } = yield* libraryFor(input.instanceId);
      const canonical = yield* fileOperation(`Could not find ${input.path}.`, () =>
        NodeFSP.realpath(NodePath.dirname(input.path)),
      );
      const linkPath = NodePath.join(
        rootFor(library, input.projectRoot),
        NodePath.basename(NodePath.dirname(input.path)),
      );
      if (yield* pathExists(linkPath)) {
        return yield* new SkillLibraryError({
          message: `A skill with this name already exists at ${linkPath}.`,
        });
      }
      yield* fileOperation(`Could not link the skill into ${linkPath}.`, async () => {
        await NodeFSP.mkdir(NodePath.dirname(linkPath), { recursive: true });
        await linkSkill(linkPath, canonical, input.projectRoot);
      });
      yield* refreshSkills(linkPath, input.projectRoot);
    },
  );

  const remove: SkillLibrary["Service"]["delete"] = Effect.fn("SkillLibrary.delete")(
    function* (input) {
      const directory = NodePath.dirname(input.path);
      const stats = yield* fileOperation(`Could not find ${directory}.`, () =>
        NodeFSP.lstat(directory),
      );
      // A link is one provider's view of a skill kept elsewhere: only the link goes.
      if (stats.isSymbolicLink()) {
        yield* fileOperation(`Could not remove ${directory}.`, () => NodeFSP.unlink(directory));
        yield* refreshSkills(input.path);
        return {};
      }
      // The real folder: remove the links other providers had to it too, in
      // their personal folders and in any scanned project holding it, so none
      // of them is left pointing at nothing.
      const all = yield* instances.listInstances;
      const projects = yield* scannedProjectsContaining(input.path);
      const roots = [
        ...new Set(
          all.flatMap(({ skillLibrary }) =>
            skillLibrary
              ? [
                  skillLibrary.personalRoot,
                  ...projects.map((cwd) => NodePath.join(cwd, skillLibrary.projectFolder)),
                ]
              : [],
          ),
        ),
      ];
      const canonical = yield* fileOperation(`Could not find ${directory}.`, () =>
        NodeFSP.realpath(directory),
      );
      for (const root of roots) {
        const linkPath = NodePath.join(root, NodePath.basename(directory));
        if (linkPath === directory) continue;
        const pointsHere = yield* Effect.promise(() =>
          NodeFSP.lstat(linkPath)
            .then(async (link) =>
              link.isSymbolicLink() ? (await NodeFSP.realpath(linkPath)) === canonical : false,
            )
            .catch(() => false),
        );
        if (pointsHere) {
          yield* fileOperation(`Could not remove ${linkPath}.`, () => NodeFSP.unlink(linkPath));
        }
      }
      const trash = NodePath.join(homeDirectory, ".Trash");
      const canTrash = platform === "darwin" && (yield* pathExists(trash));
      if (!canTrash) {
        yield* fileOperation(`Could not delete ${directory}.`, () =>
          NodeFSP.rm(directory, { recursive: true }),
        );
        yield* refreshSkills(input.path);
        return {};
      }
      let trashedTo = NodePath.join(trash, NodePath.basename(directory));
      for (let attempt = 2; yield* pathExists(trashedTo); attempt += 1) {
        trashedTo = NodePath.join(trash, `${NodePath.basename(directory)} ${attempt}`);
      }
      yield* fileOperation(`Could not move ${directory} to the Trash.`, () =>
        NodeFSP.rename(directory, trashedTo),
      );
      yield* refreshSkills(input.path);
      return { trashedTo };
    },
  );

  return SkillLibrary.of({ create, save, setEnabled, share, delete: remove });
});

export const layer = Layer.effect(SkillLibrary, make);
