// Personal build: plays one message at a time, generating a sentence or two
// ahead of what you hear and highlighting each word as it's spoken. Pausing
// keeps your place; clicking a sentence of the message jumps there. The model
// stays loaded for a few minutes after the last playback, then the worker is
// closed to hand its memory back.
import { useSyncExternalStore } from "react";

import { toastManager } from "~/components/ui/toast";
import type { ReadAloudWorkerRequest, ReadAloudWorkerResponse } from "./readAloud.worker";
import ReadAloudWorker from "./readAloud.worker.ts?worker";
import { MessageHighlighter } from "./readAloudHighlight";
import { readAloudPreferences, type ReadAloudVoice } from "./readAloudSettings";
import { speakableChunks } from "./readAloudText";
import type { WordTiming } from "./readAloudTimings";

export type ReadAloudState =
  | { readonly status: "idle" }
  | {
      readonly status: "loading" | "playing" | "paused";
      /** The message being read. */
      readonly key: string;
      /** The thread it belongs to, so the sidebar can show which chat is talking. */
      readonly threadKey: string;
      /** Set while the voice model downloads, the first time only. */
      readonly downloadPercent: number | null;
    };

// Enough buffered audio to ride out a slow sentence, without generating
// a whole long answer the user may stop after a few seconds.
const BUFFER_AHEAD_SECONDS = 8;
const RELEASE_MODEL_AFTER_MS = 5 * 60_000;
// Where transformers.js keeps downloaded models in the browser's Cache Storage.
const MODEL_CACHE_NAME = "transformers-cache";

type Clip = {
  readonly chunk: number;
  readonly url: string;
  /** Created when the clip arrives, so it's loaded before the previous one ends. */
  readonly audio: HTMLAudioElement;
  readonly duration: number;
  readonly words: readonly WordTiming[];
};

type Session = {
  readonly key: string;
  readonly threadKey: string;
  readonly chunks: readonly string[];
  /** Index of each chunk's first word among all spoken words. */
  readonly chunkWordOffsets: readonly number[];
  readonly voice: ReadAloudVoice;
  readonly speed: number;
  readonly highlighter: MessageHighlighter;
  nextChunk: number;
  /** The sentence being generated, so a jump can ignore it when it arrives. */
  pendingRequest: { readonly id: number; readonly chunk: number } | null;
  paused: boolean;
  readonly ready: Clip[];
  playing: { readonly clip: Clip; readonly audio: HTMLAudioElement } | null;
  wordTimer: ReturnType<typeof setTimeout> | null;
};

let state: ReadAloudState = { status: "idle" };
const listeners = new Set<() => void>();
let worker: Worker | null = null;
let session: Session | null = null;
let requestCounter = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function setState(next: ReadAloudState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadAloudState(): ReadAloudState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const created = new ReadAloudWorker();
  created.addEventListener("message", (event: MessageEvent<ReadAloudWorkerResponse>) =>
    handleWorkerMessage(event.data),
  );
  created.addEventListener("error", (event) => fail(event.message || "The voice engine crashed."));
  worker = created;
  return created;
}

function handleWorkerMessage(message: ReadAloudWorkerResponse) {
  const current = session;
  if (!current) return;
  if (message.type === "progress") {
    // Loading from the cache reports progress too, jumping straight to 100%.
    const downloadPercent = message.percent < 100 ? message.percent : null;
    if (state.status === "loading" && state.downloadPercent !== downloadPercent) {
      setState({ ...state, downloadPercent });
    }
    return;
  }
  if (message.id !== current.pendingRequest?.id) {
    // A jump abandoned this sentence; ask for the one it wants now.
    if (current.pendingRequest === null) pump(current);
    return;
  }
  const { chunk } = current.pendingRequest;
  current.pendingRequest = null;
  if (message.type === "error") {
    fail(message.message);
    return;
  }
  const url = URL.createObjectURL(wavBlob(message.samples, message.sampleRate));
  const audio = new Audio(url);
  audio.preload = "auto";
  // Speeding up playback, pitch kept, rather than asking the model to talk
  // faster: the model's own speed setting swallows short words.
  audio.preservesPitch = true;
  audio.defaultPlaybackRate = current.speed; // Survives the element's load resetting the rate.
  audio.playbackRate = current.speed;
  current.ready.push({
    chunk,
    url,
    audio,
    duration: message.samples.length / message.sampleRate,
    words: message.words,
  });
  if (!current.playing) playNext(current);
  pump(current);
}

function playNext(current: Session) {
  const clip = current.ready.shift();
  if (!clip) {
    if (current.pendingRequest === null && current.nextChunk >= current.chunks.length) {
      finish(current);
    }
    return;
  }
  const { audio } = clip;
  current.playing = { clip, audio };
  audio.addEventListener("playing", () => highlightWord(current));
  audio.addEventListener("ended", () => {
    URL.revokeObjectURL(clip.url);
    if (session !== current || current.playing?.audio !== audio) return;
    current.playing = null;
    playNext(current);
    pump(current);
  });
  if (current.paused) return;
  play(current, audio);
  if (state.status === "loading") {
    setState({
      status: "playing",
      key: current.key,
      threadKey: current.threadKey,
      downloadPercent: null,
    });
  }
}

function play(current: Session, audio: HTMLAudioElement) {
  audio.play().catch((error: unknown) => {
    if (session === current && !current.paused) {
      fail(error instanceof Error ? error.message : String(error));
    }
  });
}

/** Highlights the word at the playhead, then waits for the next word to start. */
function highlightWord(current: Session) {
  if (current.wordTimer) clearTimeout(current.wordTimer);
  current.wordTimer = null;
  const playing = current.playing;
  if (session !== current || !playing || playing.audio.paused) return;
  const { clip, audio } = playing;
  const time = audio.currentTime;
  let index = 0;
  while (index + 1 < clip.words.length && clip.words[index + 1]!.start <= time) index += 1;
  const offset = current.chunkWordOffsets[clip.chunk] ?? 0;
  current.highlighter.show(offset + index, {
    first: offset,
    last: offset + Math.max(clip.words.length - 1, 0),
  });
  const next = clip.words[index + 1];
  if (next) {
    const delay = ((next.start - time) / audio.playbackRate) * 1000;
    current.wordTimer = setTimeout(() => highlightWord(current), Math.max(delay, 16));
  }
}

/** Asks for the next sentence when nothing is generating and the buffer is running low. */
function pump(current: Session) {
  if (current.pendingRequest !== null) return;
  if (current.nextChunk >= current.chunks.length) return;
  const playing = current.playing;
  const remaining = playing ? playing.clip.duration - playing.audio.currentTime : 0;
  const buffered = current.ready.reduce((sum, clip) => sum + clip.duration, remaining);
  if (buffered / current.speed > BUFFER_AHEAD_SECONDS) return;
  const id = ++requestCounter;
  const request: ReadAloudWorkerRequest = {
    id,
    text: current.chunks[current.nextChunk]!,
    voice: current.voice,
  };
  current.pendingRequest = { id, chunk: current.nextChunk };
  current.nextChunk += 1;
  ensureWorker().postMessage(request);
}

/** The sentence holding spoken word `word`. */
function chunkOfWord(current: Session, word: number): number {
  let chunk = 0;
  while (
    chunk + 1 < current.chunkWordOffsets.length &&
    current.chunkWordOffsets[chunk + 1]! <= word
  ) {
    chunk += 1;
  }
  return chunk;
}

/** Drops what's playing and buffered, and reads on from sentence `chunk`. */
function jumpTo(current: Session, chunk: number) {
  if (current.wordTimer) clearTimeout(current.wordTimer);
  current.wordTimer = null;
  if (current.playing) {
    current.playing.audio.pause();
    URL.revokeObjectURL(current.playing.clip.url);
    current.playing = null;
  }
  for (const clip of current.ready.splice(0)) URL.revokeObjectURL(clip.url);
  current.nextChunk = chunk;
  // A sentence still generating is dropped when it arrives, which then asks for this one.
  const busy = current.pendingRequest !== null;
  current.pendingRequest = null;
  current.paused = false;
  // Show where reading picks up while its first sentence is generated.
  const first = current.chunkWordOffsets[chunk] ?? 0;
  const last = (current.chunkWordOffsets[chunk + 1] ?? first + 1) - 1;
  current.highlighter.show(first, { first, last });
  setState({
    status: "loading",
    key: current.key,
    threadKey: current.threadKey,
    downloadPercent: null,
  });
  if (!busy) pump(current);
}

/**
 * Reads `markdown`, message `key` of thread `threadKey`, aloud. Stops anything
 * already playing. With `from`, a point in the message on screen, starts at
 * the sentence there instead of the top.
 */
export function startReadAloud(
  key: string,
  threadKey: string,
  markdown: string,
  from?: { readonly node: Node; readonly offset: number },
) {
  stopReadAloud();
  const chunks = speakableChunks(markdown);
  if (chunks.length === 0) {
    toastManager.add({
      type: "info",
      title: "Nothing to read aloud",
      description: "This message is only code.",
    });
    return;
  }
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  const chunkWords = chunks.map((chunk) => chunk.split(/\s+/).filter((word) => word !== ""));
  const chunkWordOffsets: number[] = [];
  let offset = 0;
  for (const words of chunkWords) {
    chunkWordOffsets.push(offset);
    offset += words.length;
  }
  const current: Session = {
    key,
    threadKey,
    chunks,
    chunkWordOffsets,
    ...readAloudPreferences(),
    highlighter: new MessageHighlighter(key, chunkWords.flat()),
    nextChunk: 0,
    pendingRequest: null,
    paused: false,
    ready: [],
    playing: null,
    wordTimer: null,
  };
  session = current;
  document.addEventListener("click", jumpOnClick);
  const word = from ? current.highlighter.spokenWordAt(from.node, from.offset) : null;
  if (word !== null) {
    jumpTo(current, chunkOfWord(current, word));
    return;
  }
  setState({ status: "loading", key, threadKey, downloadPercent: null });
  pump(current);
}

/** Pauses reading, keeping its place. */
export function pauseReadAloud() {
  const current = session;
  if (!current || current.paused || state.status !== "playing") return;
  current.paused = true;
  current.playing?.audio.pause();
  if (current.wordTimer) clearTimeout(current.wordTimer);
  current.wordTimer = null;
  setState({ ...state, status: "paused" });
}

/** Picks up reading where it was paused. */
export function resumeReadAloud() {
  const current = session;
  if (!current || !current.paused || state.status !== "paused") return;
  current.paused = false;
  setState({ ...state, status: "playing" });
  if (current.playing) play(current, current.playing.audio);
  else playNext(current);
}

/**
 * A plain click on a sentence of the message being read jumps there. Clicks
 * that select text, follow a link, or press a control keep their usual job.
 */
function jumpOnClick(event: MouseEvent) {
  const current = session;
  if (!current || event.button !== 0 || event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest("a, button, input, textarea, summary")) return;
  if (!current.highlighter.contains(target)) return;
  if (!(window.getSelection()?.isCollapsed ?? true)) return;
  const point = caretAt(event.clientX, event.clientY);
  const word = point ? current.highlighter.spokenWordAt(point.node, point.offset) : null;
  if (word !== null) jumpTo(current, chunkOfWord(current, word));
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if ("caretPositionFromPoint" in document) {
    const position = document.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  const range = (document as Document).caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** Deletes the downloaded voice model. The next playback downloads it again. */
export async function deleteReadAloudModel() {
  stopReadAloud();
  releaseModel();
  await caches.delete(MODEL_CACHE_NAME);
}

/** Whether the voice model has been downloaded on this device. */
export async function hasReadAloudModel() {
  return typeof caches !== "undefined" && (await caches.has(MODEL_CACHE_NAME));
}

export function stopReadAloud() {
  const current = session;
  if (!current) return;
  session = null;
  current.playing?.audio.pause();
  if (current.playing) URL.revokeObjectURL(current.playing.clip.url);
  for (const clip of current.ready) URL.revokeObjectURL(clip.url);
  finish(current);
}

function finish(current = session) {
  document.removeEventListener("click", jumpOnClick);
  if (current?.wordTimer) clearTimeout(current.wordTimer);
  current?.highlighter.clear();
  session = null;
  setState({ status: "idle" });
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(releaseModel, RELEASE_MODEL_AFTER_MS);
}

function releaseModel() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  if (session) return;
  worker?.terminate();
  worker = null;
}

function fail(message: string) {
  stopReadAloud();
  // The worker may be wedged; the next attempt starts a fresh one.
  worker?.terminate();
  worker = null;
  toastManager.add({ type: "error", title: "Couldn't read aloud", description: message });
}

/** 16-bit mono WAV, which every browser's audio element plays. */
function wavBlob(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(44 + index * 2, sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
