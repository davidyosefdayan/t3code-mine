/**
 * Personal build: managing skills from the Skills page. Skills are folders
 * with a SKILL.md that each provider reads from its own places; these calls
 * create, edit, share, switch off, and delete them on the environment host.
 *
 * @module skills
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/** Folder name and `/command`: lowercase words joined by hyphens. */
export const SkillName = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));
export type SkillName = typeof SkillName.Type;

/** A SKILL.md on the environment host, as providers report it. */
const SkillFilePath = TrimmedNonEmptyString.check(Schema.isPattern(/(^|[/\\])SKILL\.md$/));

export const SkillCreateInput = Schema.Struct({
  name: SkillName,
  description: TrimmedNonEmptyString,
  instructions: Schema.String,
  /**
   * Providers that should load the skill. The first holds the real folder;
   * every other one gets a link to it, so there is one copy to edit.
   */
  instanceIds: Schema.NonEmptyArray(ProviderInstanceId),
  /** A project folder for a project skill; absent for a personal skill. */
  projectRoot: Schema.optional(TrimmedNonEmptyString),
});
export type SkillCreateInput = typeof SkillCreateInput.Type;

export const SkillCreateResult = Schema.Struct({
  /** The SKILL.md that holds the skill. */
  path: TrimmedNonEmptyString,
});
export type SkillCreateResult = typeof SkillCreateResult.Type;

export const SkillSaveInput = Schema.Struct({
  path: SkillFilePath,
  contents: Schema.String,
});
export type SkillSaveInput = typeof SkillSaveInput.Type;

export const SkillSetEnabledInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  path: SkillFilePath,
  name: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
});
export type SkillSetEnabledInput = typeof SkillSetEnabledInput.Type;

export const SkillShareInput = Schema.Struct({
  /** The skill to share, from any provider. */
  path: SkillFilePath,
  /** The provider that should load it too. */
  instanceId: ProviderInstanceId,
  /** Share into this project's folder rather than the personal one. */
  projectRoot: Schema.optional(TrimmedNonEmptyString),
});
export type SkillShareInput = typeof SkillShareInput.Type;

export const SkillDeleteInput = Schema.Struct({
  path: SkillFilePath,
});
export type SkillDeleteInput = typeof SkillDeleteInput.Type;

export const SkillDeleteResult = Schema.Struct({
  /** Where the folder went; absent when it was only a link. */
  trashedTo: Schema.optional(TrimmedNonEmptyString),
});
export type SkillDeleteResult = typeof SkillDeleteResult.Type;

export class SkillLibraryError extends Schema.TaggedError<SkillLibraryError>()(
  "SkillLibraryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
