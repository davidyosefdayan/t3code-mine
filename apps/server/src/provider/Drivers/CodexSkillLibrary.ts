/**
 * Personal build: Codex's skill library for the Skills page.
 *
 * Personal skills live in `$CODEX_HOME/skills`, project skills in
 * `<project>/.agents/skills`. Codex owns its on/off switch: the app server's
 * `skills/config/write` records it in Codex's config, keyed by the SKILL.md
 * path, so T3 Code never edits that file itself.
 *
 * @module provider/Drivers/CodexSkillLibrary
 */
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { ProviderDriverError } from "../Errors.ts";
import type { ProviderSkillLibrary } from "@t3tools/provider-core/server/driver";

export function makeCodexSkillLibrary<E>(input: {
  readonly homePath: string;
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly path: Path.Path;
  /** Runs `skills/config/write` against this instance's app server. */
  readonly writeSkillConfig: (params: {
    readonly path: string;
    readonly enabled: boolean;
  }) => Effect.Effect<unknown, E>;
  /** Republishes the provider snapshot so the change shows everywhere. */
  readonly refresh: Effect.Effect<unknown>;
}): ProviderSkillLibrary {
  return {
    personalRoot: input.path.join(input.homePath, "skills"),
    projectFolder: input.path.join(".agents", "skills"),
    setEnabled: ({ path, enabled }) =>
      input.writeSkillConfig({ path, enabled }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: input.driver,
              instanceId: input.instanceId,
              detail: `Codex could not turn the skill ${enabled ? "on" : "off"}.`,
              cause,
            }),
        ),
        Effect.andThen(input.refresh),
      ),
  };
}
