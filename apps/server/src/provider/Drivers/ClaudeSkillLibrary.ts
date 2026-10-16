/**
 * Personal build: Claude Code's skill library for the Skills page.
 *
 * Personal skills live in `<config dir>/skills`, project skills in
 * `<project>/.claude/skills`. Claude Code switches a skill off through
 * `skillOverrides` in its user `settings.json` (the same file `ClaudeSkills`
 * reads back), so turning one off writes `"off"` there and turning it on
 * removes that entry, leaving any other override value alone.
 *
 * @module provider/Drivers/ClaudeSkillLibrary
 */
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { ProviderDriverError } from "../Errors.ts";
import type { ProviderSkillLibrary } from "@t3tools/provider-core/server/driver";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The settings text with one skill's override set to off, or that "off"
 * removed. Returns null when the text is not plain JSON: Claude Code tolerates
 * comments in this hand-edited file, and rewriting it would drop them.
 */
export function applyClaudeSkillOverride(
  contents: string | undefined,
  name: string,
  enabled: boolean,
): string | null {
  let settings: unknown = {};
  if (contents !== undefined && contents.trim().length > 0) {
    try {
      settings = JSON.parse(contents);
    } catch {
      return null;
    }
  }
  if (!isRecord(settings)) return null;
  const overrides = isRecord(settings.skillOverrides) ? { ...settings.skillOverrides } : {};
  if (enabled) {
    if (overrides[name] === "off") delete overrides[name];
  } else {
    overrides[name] = "off";
  }
  const next: Record<string, unknown> = { ...settings };
  if (Object.keys(overrides).length > 0) next.skillOverrides = overrides;
  else delete next.skillOverrides;
  return `${JSON.stringify(next, null, 2)}\n`;
}

export function makeClaudeSkillLibrary(input: {
  readonly configDir: string;
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  /** Republishes the provider snapshot so the change shows everywhere. */
  readonly refresh: Effect.Effect<unknown>;
}): ProviderSkillLibrary {
  const { path, fileSystem } = input;
  const settingsPath = path.join(input.configDir, "settings.json");
  const fail = (detail: string, cause?: unknown) =>
    new ProviderDriverError({
      driver: input.driver,
      instanceId: input.instanceId,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });
  return {
    personalRoot: path.join(input.configDir, "skills"),
    projectFolder: path.join(".claude", "skills"),
    setEnabled: Effect.fn("ClaudeSkillLibrary.setEnabled")(
      function* ({ name, enabled }) {
        const contents = yield* fileSystem
          .readFileString(settingsPath)
          .pipe(Effect.orElseSucceed(() => undefined));
        const next = applyClaudeSkillOverride(contents, name, enabled);
        if (next === null) {
          return yield* fail(
            `Claude's settings.json is not plain JSON, so T3 Code will not rewrite it. Set "skillOverrides": { "${name}": "off" } there by hand.`,
          );
        }
        if (next !== contents) {
          yield* writeFileStringAtomically({ filePath: settingsPath, contents: next }).pipe(
            Effect.mapError((cause) => fail("Could not write Claude's settings.json.", cause)),
          );
        }
        yield* input.refresh;
      },
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    ),
  };
}
