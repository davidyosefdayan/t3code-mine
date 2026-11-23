// Personal build: read aloud with the Siri voices of the server's Mac.
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ServerReadAloudVoice = Schema.Struct({
  /** `<kind>:<name>`, as `speak` takes it. */
  id: TrimmedNonEmptyString,
  name: Schema.String,
  gender: Schema.String,
  language: Schema.String,
  /** Expressive voices sound more natural; standard ones report each word's timing. */
  kind: Schema.Literals(["expressive", "standard"]),
});
export type ServerReadAloudVoice = typeof ServerReadAloudVoice.Type;

export const ServerReadAloudVoices = Schema.Struct({
  supported: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  voices: Schema.Array(ServerReadAloudVoice),
});
export type ServerReadAloudVoices = typeof ServerReadAloudVoices.Type;

export const ServerReadAloudSpeakInput = Schema.Struct({
  text: TrimmedNonEmptyString,
  voice: TrimmedNonEmptyString,
});
export type ServerReadAloudSpeakInput = typeof ServerReadAloudSpeakInput.Type;

export const ServerReadAloudWordTiming = Schema.Struct({
  start: Schema.Number,
  /** Where the word is in the text, in UTF-16 code units. */
  location: Schema.Number,
  length: Schema.Number,
});
export type ServerReadAloudWordTiming = typeof ServerReadAloudWordTiming.Type;

export const ServerReadAloudClip = Schema.Struct({
  sampleRate: Schema.Number,
  /** 16-bit little-endian mono PCM, base64. */
  pcm: Schema.String,
  /** Empty when the voice doesn't report timings. */
  words: Schema.Array(ServerReadAloudWordTiming),
});
export type ServerReadAloudClip = typeof ServerReadAloudClip.Type;

export class ServerReadAloudError extends Schema.TaggedError<ServerReadAloudError>()(
  "ServerReadAloudError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
