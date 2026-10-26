// Personal build: plays one message at a time, generating a sentence or two
// ahead of what you hear and highlighting each word as it's spoken. Pausing
// keeps your place. Clicking or selecting text never moves it: seek from the
// player bar above the composer, or select text and press Listen. The model
// stays loaded for a few minutes after the last playback, then the worker is
// closed to hand its memory back.
import { useSyncExternalStore } from "react";

import { toastManager } from "~/components/ui/toast";
import type { ReadAloudWorkerRequest, ReadAloudWorkerResponse } from "./readAloud.worker";
import ReadAloudWorker from "./readAloud.worker.ts?worker";
import { MessageHighlighter } from "./readAloudHighlight";
import {
  claimMediaSession,
  releaseMediaSession,
  setMediaSessionPlaying,
} from "./readAloudMediaSession";
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

/** Where reading is, for the player bar. Kept apart from the state above so a word change
 * re-renders only the bar, not every answer's speaker button. */
export type ReadAloudProgress = {
  readonly chunks: readonly string[];
  /** Index of each chunk's first word among all spoken words. */
  readonly chunkWordOffsets: readonly number[];
  readonly totalWords: number;
  /** The spoken word at the playhead. */
  readonly word: number;
  readonly speed: number;
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
  speed: number;
  readonly totalWords: number;
  word: number;
  readonly highlighter: MessageHighlighter;
  nextChunk: number;
  /** The sentence being generated, so a jump can ignore it when it arrives. */
  pendingRequest: { readonly id: number; readonly chunk: number } | null;
  /** A seek into the middle of a sentence that hasn't been generated yet: where its clip starts. */
  startAt: { readonly chunk: number; readonly word: number } | null;
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
let progress: ReadAloudProgress | null = null;
const progressListeners = new Set<() => void>();

function setState(next: ReadAloudState) {
  state = next;
  // Loading counts as playing: it's what the reader asked for, and it plays when ready.
  if (next.status !== "idle") setMediaSessionPlaying(next.status !== "paused");
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

function subscribeProgress(listener: () => void) {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function useReadAloudProgress(): ReadAloudProgress | null {
  return useSyncExternalStore(
    subscribeProgress,
    () => progress,
    () => progress,
  );
}

function publishProgress(current: Session | null) {
  progress = current
    ? {
        chunks: current.chunks,
        chunkWordOffsets: current.chunkWordOffsets,
        totalWords: current.totalWords,
        word: current.word,
        speed: current.speed,
      }
    : null;
  for (const listener of progressListeners) listener();
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
  if (current.startAt?.chunk === clip.chunk) {
    audio.currentTime = wordStartTime(current, clip, current.startAt.word);
  }
  current.startAt = null;
  current.playing = { clip, audio };
  audio.addEventListener("playing", () => highlightWord(current));
  // Paused by something other than the player (the system can pause media on
  // its own): go through pause, so the bar and Now Playing say so too. Our own
  // pauses already moved on from this clip or marked the session paused.
  audio.addEventListener("pause", () => {
    if (
      session === current &&
      current.playing?.audio === audio &&
      !current.paused &&
      !audio.ended
    ) {
      pauseReadAloud();
    }
  });
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
  if (current.word !== offset + index) {
    current.word = offset + index;
    publishProgress(current);
  }
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

/** When word `word` starts within `clip`, in seconds of its audio. */
function wordStartTime(current: Session, clip: Clip, word: number): number {
  const index = word - (current.chunkWordOffsets[clip.chunk] ?? 0);
  return clip.words[Math.min(Math.max(index, 0), clip.words.length - 1)]?.start ?? 0;
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

/**
 * Moves the playhead to spoken word `word`. Audio already generated is reused,
 * so a seek within it is instant; otherwise the word's sentence is generated
 * and starts at that word. Pausing is left as it is: the progress bar and skip
 * buttons move a paused reading without playing it.
 */
function seekTo(current: Session, word: number) {
  const target = Math.min(Math.max(word, 0), current.totalWords - 1);
  const chunk = chunkOfWord(current, target);
  if (current.wordTimer) clearTimeout(current.wordTimer);
  current.wordTimer = null;
  const playing = current.playing;
  if (playing?.clip.chunk === chunk) {
    playing.audio.currentTime = wordStartTime(current, playing.clip, target);
  } else {
    if (playing) {
      playing.audio.pause();
      URL.revokeObjectURL(playing.clip.url);
      current.playing = null;
    }
    const buffered = current.ready.findIndex((clip) => clip.chunk === chunk);
    const busy = current.pendingRequest !== null;
    if (buffered >= 0) {
      for (const clip of current.ready.splice(0, buffered)) URL.revokeObjectURL(clip.url);
    } else {
      for (const clip of current.ready.splice(0)) URL.revokeObjectURL(clip.url);
      current.nextChunk = chunk;
      // A sentence still generating is dropped when it arrives, which then asks for this one.
      current.pendingRequest = null;
    }
    current.startAt = { chunk, word: target };
    playNext(current);
    if (!busy) pump(current);
  }
  current.word = target;
  publishProgress(current);
  showCurrentWord(current);
  if (current.paused) return;
  if (current.playing) highlightWord(current);
  else setState({ ...activeState(current), status: "loading" });
}

function activeState(current: Session) {
  return { key: current.key, threadKey: current.threadKey, downloadPercent: null };
}

/**
 * Reads `markdown`, message `key` of thread `threadKey`, aloud. Stops anything
 * already playing. With `from`, a point in the message on screen, starts at
 * the word there instead of the top.
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
    totalWords: offset,
    word: 0,
    ...readAloudPreferences(),
    highlighter: new MessageHighlighter(key, chunkWords.flat()),
    nextChunk: 0,
    pendingRequest: null,
    startAt: null,
    paused: false,
    ready: [],
    playing: null,
    wordTimer: null,
  };
  session = current;
  claimMediaSession(chunks[0]!, {
    play: resumeReadAloud,
    pause: pauseReadAloud,
    previous: () => skipReadAloud(-1),
    next: () => skipReadAloud(1),
    stop: stopReadAloud,
  });
  setState({ status: "loading", ...activeState(current) });
  const word = from ? current.highlighter.spokenWordAt(from.node, from.offset) : null;
  if (word !== null) {
    seekTo(current, word);
    return;
  }
  publishProgress(current);
  pump(current);
}

/**
 * Plays message `key` from a point in it on screen (where a selection starts),
 * picking up the reading already under way when it's the same message.
 */
export function listenFrom(
  key: string,
  threadKey: string,
  markdown: string,
  from: { readonly node: Node; readonly offset: number },
) {
  const current = session;
  if (current?.key !== key) {
    startReadAloud(key, threadKey, markdown, from);
    return;
  }
  const word = current.highlighter.spokenWordAt(from.node, from.offset);
  if (word !== null) seekTo(current, word);
  resumeReadAloud();
}

/** Jumps to spoken word `word` of the message being read. */
export function seekReadAloud(word: number) {
  if (session) seekTo(session, word);
}

/**
 * Moves a sentence forward or back. Back restarts the sentence being heard,
 * unless it only just began, like a music player's previous button.
 */
export function skipReadAloud(direction: -1 | 1) {
  const current = session;
  if (!current) return;
  const chunk = chunkOfWord(current, current.word);
  const playing = current.playing;
  const target =
    direction === 1
      ? chunk + 1
      : playing?.clip.chunk === chunk && playing.audio.currentTime > 2
        ? chunk
        : chunk - 1;
  if (target >= current.chunks.length) return;
  seekTo(current, current.chunkWordOffsets[Math.max(target, 0)] ?? 0);
}

/** Changes the speed of the message being read, from the word being heard. */
export function setReadAloudSpeed(speed: number) {
  const current = session;
  if (!current) return;
  current.speed = speed;
  const clips = current.playing ? [current.playing.clip, ...current.ready] : current.ready;
  for (const { audio } of clips) {
    audio.defaultPlaybackRate = speed;
    audio.playbackRate = speed;
  }
  publishProgress(current);
  // The next word's timer was set for the old speed.
  if (!current.paused) highlightWord(current);
}

type RevealListener = (messageId: string) => Promise<void>;
let revealListener: RevealListener | null = null;

/** Lets the chat on screen get ready to scroll to a message, rendering it if needed. */
export function registerReadAloudReveal(listener: RevealListener) {
  revealListener = listener;
  return () => {
    if (revealListener === listener) revealListener = null;
  };
}

/** Scrolls the word being read into view, bringing its message into the list if needed. */
export async function revealReadAloud() {
  const current = session;
  if (!current) return;
  // The chat first lets go of the bottom (it would scroll back there) and renders the message.
  await revealListener?.(current.key);
  if (session !== current) return;
  showCurrentWord(current);
  scrollToWord(current);
}

/** Puts the word being read a third of the way down the chat, clear of the composer. */
function scrollToWord(current: Session): boolean {
  const spot = current.highlighter.locate(current.word);
  if (!spot?.scroller) return false;
  const box = spot.scroller.getBoundingClientRect();
  // Instant: the chat list cuts a smooth scroll short.
  spot.scroller.scrollBy({ top: spot.rect.top - (box.top + box.height / 3) });
  return true;
}

/** Whether spoken word `word` of the message being read is in sight, above the composer. */
export function isReadAloudWordInView(word: number): boolean {
  const spot = session?.highlighter.locate(word);
  if (!spot?.scroller) return false;
  const box = spot.scroller.getBoundingClientRect();
  const composer = document.querySelector("[data-chat-composer-stack]")?.getBoundingClientRect();
  const bottom = Math.min(box.bottom, composer?.top ?? box.bottom);
  return spot.rect.bottom > box.top && spot.rect.top < bottom;
}

/** Re-lights the word at the playhead, for when its message was just drawn again. */
function showCurrentWord(current: Session) {
  const chunk = chunkOfWord(current, current.word);
  const first = current.chunkWordOffsets[chunk] ?? 0;
  const last = (current.chunkWordOffsets[chunk + 1] ?? current.totalWords) - 1;
  current.highlighter.show(current.word, { first, last });
}

/** Pauses reading, keeping its place. While a sentence loads, it waits there instead of playing. */
export function pauseReadAloud() {
  const current = session;
  if (!current || current.paused || state.status === "idle") return;
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
  if (current.playing) {
    setState({ ...state, status: "playing" });
    play(current, current.playing.audio);
  } else if (current.ready.length > 0) {
    setState({ ...state, status: "playing" });
    playNext(current);
  } else {
    // A seek while paused is still generating; it plays when it arrives.
    setState({ ...state, status: "loading" });
  }
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
  publishProgress(null);
  releaseMediaSession();
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
