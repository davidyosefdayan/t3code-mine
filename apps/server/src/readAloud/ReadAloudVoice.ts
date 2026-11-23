// @effect-diagnostics nodeBuiltinImport:off - runs the siri-tts command and reads its temp files.
// Personal build: read aloud with the Siri voices installed on the server's Mac,
// through the siri-tts command (github.com/maximilianromer/siri-tts-cli), which
// reaches the Siri voices Apple's public speech APIs leave out.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  ServerReadAloudError,
  type ServerReadAloudClip,
  type ServerReadAloudSpeakInput,
  type ServerReadAloudVoice,
  type ServerReadAloudVoices,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";

const INSTALL_HINT =
  "Install siri-tts (github.com/maximilianromer/siri-tts-cli) to use the Siri voices.";

async function exists(path: string) {
  return NodeFSP.access(path).then(
    () => true,
    () => false,
  );
}

/** `siri-tts` from PATH or its usual install spots; the Mac app's PATH is often minimal. */
async function findSiriTts(): Promise<string | null> {
  const home = NodeOS.homedir();
  const dirs = [
    ...(process.env.PATH ?? "").split(":").filter(Boolean),
    NodePath.join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of dirs) {
    const candidate = NodePath.join(dir, "siri-tts");
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function run(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      command,
      args,
      { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: 120_000 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.toString().trim().split("\n").at(-1);
          reject(new Error(detail || error.message));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

const titleCase = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** "en-US:fmvoice:male:aaron:premium:0" → an expressive male voice named Aaron. */
export function readAloudVoiceFromAsset(asset: {
  readonly name: string;
  readonly language: string;
  readonly assetKey: string;
}): ServerReadAloudVoice | null {
  const [, family, gender] = asset.assetKey.split(":");
  const kind = family === "fmvoice" ? "expressive" : family === "natural" ? "standard" : null;
  if (!kind) return null;
  const unnamed = /^[a-z]{2}-[A-Z]{2}-([A-Z])$/.exec(asset.name);
  return {
    id: `${kind}:${asset.name}`,
    name: unnamed ? `Voice ${unnamed[1]}` : titleCase(asset.name),
    gender: gender ?? "",
    language: asset.language,
    kind,
  };
}

/** Siri returns 48 kHz; halving it keeps speech clear at half the bytes on the wire. */
function halveSampleRate(pcm: Buffer): Buffer {
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const output = new Int16Array(input.length >> 1);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (input[index * 2]! + input[index * 2 + 1]!) >> 1;
  }
  return Buffer.from(output.buffer);
}

type TimingsFile = {
  readonly timings: ReadonlyArray<{
    readonly start: number;
    readonly utf16Location: number;
    readonly utf16Length: number;
  }>;
};

async function speakWithSiri(input: ServerReadAloudSpeakInput): Promise<ServerReadAloudClip> {
  const command = await findSiriTts();
  if (!command) throw new Error(INSTALL_HINT);
  const separator = input.voice.indexOf(":");
  const kind = input.voice.slice(0, separator);
  const name = input.voice.slice(separator + 1);
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-read-aloud-"));
  try {
    const textPath = NodePath.join(dir, "text.txt");
    const timingsPath = NodePath.join(dir, "timings.json");
    await NodeFSP.writeFile(textPath, input.text);
    const standard = kind === "standard";
    const pcm = await run(command, [
      "--generation",
      standard ? "legacy" : "expressive",
      "--voice",
      name,
      "--format",
      "pcm",
      ...(standard ? ["--timings", timingsPath] : []),
      "-f",
      textPath,
      "-o",
      "-",
    ]);
    const timings: TimingsFile = standard
      ? JSON.parse(await NodeFSP.readFile(timingsPath, "utf8").catch(() => '{"timings":[]}'))
      : { timings: [] };
    return {
      sampleRate: 24_000,
      pcm: halveSampleRate(pcm).toString("base64"),
      words: timings.timings.map((timing) => ({
        start: timing.start,
        location: timing.utf16Location,
        length: timing.utf16Length,
      })),
    };
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
}

async function listSiriVoices(): Promise<ServerReadAloudVoices> {
  const command = await findSiriTts();
  if (!command) return { supported: false, reason: INSTALL_HINT, voices: [] };
  try {
    const listed = JSON.parse((await run(command, ["voices", "--json"])).toString()) as {
      voices: Array<{ name: string; language: string; assetKey: string; installed: boolean }>;
    };
    const found = listed.voices
      .filter((voice) => voice.installed && voice.language.startsWith("en"))
      .flatMap((voice) => readAloudVoiceFromAsset(voice) ?? [])
      // Of the older standard voices, only Nora is worth offering.
      .filter((voice) => voice.kind === "expressive" || voice.name === "Nora");
    return { supported: true, voices: found };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : "Couldn't list the Siri voices.",
      voices: [],
    };
  }
}

export class ReadAloudVoice extends Context.Service<
  ReadAloudVoice,
  {
    readonly voices: Effect.Effect<ServerReadAloudVoices>;
    readonly speak: (
      input: ServerReadAloudSpeakInput,
    ) => Effect.Effect<ServerReadAloudClip, ServerReadAloudError>;
  }
>()("t3/readAloud/ReadAloudVoice") {}

const make = Effect.gen(function* () {
  const onMac = (yield* HostProcess.Platform) === "darwin";

  const voices: ReadAloudVoice["Service"]["voices"] = Effect.promise(() =>
    onMac
      ? listSiriVoices()
      : Promise.resolve({ supported: false, reason: "Siri voices need a Mac.", voices: [] }),
  ).pipe(Effect.withSpan("ReadAloudVoice.voices"));

  const speak: ReadAloudVoice["Service"]["speak"] = Effect.fn("ReadAloudVoice.speak")(
    function* (input) {
      if (!onMac) return yield* new ServerReadAloudError({ message: "Siri voices need a Mac." });
      return yield* Effect.tryPromise({
        try: () => speakWithSiri(input),
        catch: (cause) =>
          new ServerReadAloudError({
            message:
              cause instanceof Error && cause.message ? cause.message : "The Siri voice failed.",
            cause,
          }),
      });
    },
  );

  return ReadAloudVoice.of({ voices, speak });
});

export const layer = Layer.effect(ReadAloudVoice, make);
