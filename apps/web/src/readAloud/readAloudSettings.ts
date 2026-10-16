// Personal build: read-aloud preferences. Saved on this device, like the theme.
import * as Schema from "effect/Schema";

import { getLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";

/** Kokoro's voices that grade C or better; the rest sound noticeably synthetic. */
export const READ_ALOUD_VOICES = [
  { id: "am_michael", name: "Michael", accent: "American", gender: "Male" },
  { id: "am_fenrir", name: "Fenrir", accent: "American", gender: "Male" },
  { id: "am_puck", name: "Puck", accent: "American", gender: "Male" },
  { id: "bm_george", name: "George", accent: "British", gender: "Male" },
  { id: "bm_fable", name: "Fable", accent: "British", gender: "Male" },
  { id: "af_heart", name: "Heart", accent: "American", gender: "Female" },
  { id: "af_bella", name: "Bella", accent: "American", gender: "Female" },
  { id: "af_nicole", name: "Nicole", accent: "American", gender: "Female" },
  { id: "bf_emma", name: "Emma", accent: "British", gender: "Female" },
] as const;

export type ReadAloudVoice = (typeof READ_ALOUD_VOICES)[number]["id"];

export const DEFAULT_READ_ALOUD_VOICE: ReadAloudVoice = "am_michael";
export const DEFAULT_READ_ALOUD_SPEED = 1;
export const MIN_READ_ALOUD_SPEED = 0.75;
export const MAX_READ_ALOUD_SPEED = 3;

const VOICE_KEY = "t3code:read-aloud-voice";
const SPEED_KEY = "t3code:read-aloud-speed";

const VoiceSchema = Schema.Literals(READ_ALOUD_VOICES.map((voice) => voice.id));

export function useReadAloudVoice() {
  return useLocalStorage(VOICE_KEY, DEFAULT_READ_ALOUD_VOICE, VoiceSchema);
}

export function useReadAloudSpeed() {
  return useLocalStorage(SPEED_KEY, DEFAULT_READ_ALOUD_SPEED, Schema.Number);
}

/** The saved preferences, read when playback starts so a change applies to the next message. */
export function readAloudPreferences(): { voice: ReadAloudVoice; speed: number } {
  let voice: ReadAloudVoice = DEFAULT_READ_ALOUD_VOICE;
  let speed = DEFAULT_READ_ALOUD_SPEED;
  try {
    voice = getLocalStorageItem(VOICE_KEY, VoiceSchema) ?? voice;
    speed = getLocalStorageItem(SPEED_KEY, Schema.Number) ?? speed;
  } catch {
    // A stored value from an older build falls back to the defaults.
  }
  return {
    voice,
    speed: Math.min(MAX_READ_ALOUD_SPEED, Math.max(MIN_READ_ALOUD_SPEED, speed)),
  };
}
