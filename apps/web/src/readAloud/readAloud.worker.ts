// Personal build: runs Kokoro off the main thread. One sentence in, one clip
// and its word timings out.
import { env, KokoroTTS } from "kokoro-js";
// ONNX Runtime's engine is served from the app, not a CDN: the desktop app's
// script policy blocks remote code, and it should work offline once downloaded.
import ortWasmUrl from "kokoro-ort-dist/ort-wasm-simd-threaded.jsep.wasm?url";

import type { ReadAloudVoice } from "./readAloudSettings";
import { wordTimings, type WordTiming } from "./readAloudTimings";

export type ReadAloudWorkerRequest = {
  readonly id: number;
  readonly text: string;
  readonly voice: ReadAloudVoice;
};

export type ReadAloudWorkerResponse =
  | { readonly type: "progress"; readonly percent: number }
  | {
      readonly type: "audio";
      readonly id: number;
      readonly samples: Float32Array;
      readonly sampleRate: number;
      /** One entry per whitespace-separated word of the request's text. */
      readonly words: readonly WordTiming[];
    }
  | { readonly type: "error"; readonly id: number; readonly message: string };

// The runtime's JS glue is already bundled into transformers.js; only the
// wasm binary is fetched separately.
env.wasmPaths = { wasm: ortWasmUrl };

// Same weights as the standard Kokoro export, plus each phoneme's duration,
// which is what lets the reader highlight words as they're spoken.
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
// Earlier builds downloaded this one; its files are removed once the new model loads.
const PREVIOUS_MODEL_PATH = "/onnx-community/Kokoro-82M-v1.0-ONNX/";
const MODEL_CACHE_NAME = "transformers-cache";

type LoadedModel = {
  readonly tts: KokoroTTS;
  readonly spaceTokenId: number;
  readonly padTokenId: number;
  /** Filled by each generation; generations run one at a time. */
  readonly last: { tokenIds: number[]; durations: number[] };
};

let model: Promise<LoadedModel> | null = null;

function post(message: ReadAloudWorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

async function loadModel(): Promise<LoadedModel> {
  // The GPU keeps generation off the CPU. Kokoro's authors recommend fp32 on
  // WebGPU; the CPU fallback uses the 8-bit model, a quarter of the download.
  const gpu = "gpu" in navigator ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  // Reading the model back from the cache reports progress too; only a real
  // download should show "Downloading voice" on the button.
  const downloading = !(await isModelCached(gpu ? "model.onnx" : "model_quantized.onnx"));
  const files = new Map<string, { loaded: number; total: number }>();
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    device: gpu ? "webgpu" : "wasm",
    dtype: gpu ? "fp32" : "q8",
    progress_callback: (event) => {
      if (!downloading || event.status !== "progress") return;
      files.set(event.file, { loaded: event.loaded, total: event.total });
      let loaded = 0;
      let total = 0;
      for (const file of files.values()) {
        loaded += file.loaded;
        total += file.total;
      }
      if (total > 0) post({ type: "progress", percent: Math.floor((loaded / total) * 100) });
    },
  });

  // kokoro-js keeps only the waveform; wrap the model call to keep the
  // durations output and the phoneme tokens they belong to.
  const last = { tokenIds: [] as number[], durations: [] as number[] };
  const run = tts.model;
  tts.model = (async (inputs: { input_ids: { data: ArrayLike<number | bigint> } }) => {
    const outputs = await run(inputs);
    last.tokenIds = Array.from(inputs.input_ids.data, Number);
    last.durations = Array.from(outputs.durations.data as ArrayLike<number>, Number);
    return outputs;
  }) as unknown as typeof tts.model;

  const vocab = (tts.tokenizer as unknown as { model: { tokens_to_ids: Map<string, number> } })
    .model.tokens_to_ids;
  void removePreviousModel();
  return {
    tts,
    spaceTokenId: vocab.get(" ") ?? 16,
    padTokenId: vocab.get("$") ?? 0,
    last,
  };
}

async function isModelCached(fileName: string): Promise<boolean> {
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const keys = await cache.keys();
    return keys.some(
      (request) =>
        request.url.includes(`/${MODEL_ID}/`) && request.url.endsWith(`/onnx/${fileName}`),
    );
  } catch {
    return false;
  }
}

async function removePreviousModel() {
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    for (const request of await cache.keys()) {
      if (request.url.includes(PREVIOUS_MODEL_PATH)) await cache.delete(request);
    }
  } catch {
    // Cleanup only; the old files are harmless if they stay.
  }
}

// Hugging Face's CDN sometimes resets a connection partway through the
// 330 MB model; trying again is usually enough.
async function loadModelWithRetries(): Promise<LoadedModel> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await loadModel();
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

async function speak({ id, text, voice }: ReadAloudWorkerRequest) {
  try {
    model ??= loadModelWithRetries().catch((error: unknown) => {
      model = null; // A failed download retries on the next request.
      throw error;
    });
    const loaded = await model;
    // Always the natural pace: the player speeds up playback instead, which
    // keeps every word intact where the model's own speed swallows short ones.
    const audio = await loaded.tts.generate(text, { voice, speed: 1 });
    const totalFrames = loaded.last.durations.reduce((sum, frames) => sum + frames, 0);
    const words = wordTimings({
      text,
      tokenIds: loaded.last.tokenIds,
      durations: loaded.last.durations,
      spaceTokenId: loaded.spaceTokenId,
      padTokenId: loaded.padTokenId,
      secondsPerFrame: totalFrames > 0 ? audio.audio.length / audio.sampling_rate / totalFrames : 0,
    });
    const clip = trimSilence(audio.audio, audio.sampling_rate, words);
    post({ type: "audio", id, sampleRate: audio.sampling_rate, ...clip }, [clip.samples.buffer]);
  } catch (error) {
    post({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  }
}

// Kokoro pads each sentence with about half a second of silence. Trimmed to
// the speech plus a short pause, the pause stays inside the clip, so it
// shortens with playback speed like the words do.
const LEAD_IN_SECONDS = 0.03;
const PAUSE_AFTER_SECONDS = 0.15;

function trimSilence(samples: Float32Array, sampleRate: number, words: readonly WordTiming[]) {
  const spoken = words.filter((word) => word.end > word.start);
  if (spoken.length === 0) return { samples, words };
  const from = Math.max(0, Math.floor((spoken[0]!.start - LEAD_IN_SECONDS) * sampleRate));
  const to = Math.min(
    samples.length,
    Math.ceil((spoken.at(-1)!.end + PAUSE_AFTER_SECONDS) * sampleRate),
  );
  const offset = from / sampleRate;
  return {
    samples: samples.slice(from, to),
    words: words.map((word) => ({
      start: Math.max(0, word.start - offset),
      end: Math.max(0, word.end - offset),
    })),
  };
}

// One generation at a time: the model can't run two at once, and a request
// sent after a stop must wait for the abandoned sentence to finish.
let queue = Promise.resolve();
self.addEventListener("message", (event: MessageEvent<ReadAloudWorkerRequest>) => {
  queue = queue.then(() => speak(event.data));
});
