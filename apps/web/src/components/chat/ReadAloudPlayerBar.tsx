// Personal build: the controls for read aloud, docked above the composer while
// an answer is being read, so they stay in reach wherever the chat is scrolled.
// Drag or click the progress bar to jump to any word (hovering shows its sentence).
import {
  LocateFixedIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import {
  pauseReadAloud,
  resumeReadAloud,
  isReadAloudWordInView,
  revealReadAloud,
  seekReadAloud,
  setReadAloudSpeed,
  skipReadAloud,
  stopReadAloud,
  useReadAloudProgress,
  useReadAloudState,
  type ReadAloudProgress,
} from "~/readAloud/readAloudPlayer";
import {
  MAX_READ_ALOUD_SPEED,
  MIN_READ_ALOUD_SPEED,
  useReadAloudSpeed,
} from "~/readAloud/readAloudSettings";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBanner } from "./ComposerBanner";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].filter(
  (speed) => speed >= MIN_READ_ALOUD_SPEED && speed <= MAX_READ_ALOUD_SPEED,
);

function formatSpeed(speed: number) {
  return `${Number(speed.toFixed(2))}×`;
}

function chunkAtWord(progress: ReadAloudProgress, word: number) {
  let chunk = 0;
  while (
    chunk + 1 < progress.chunkWordOffsets.length &&
    progress.chunkWordOffsets[chunk + 1]! <= word
  ) {
    chunk += 1;
  }
  return chunk;
}

function Control({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            type="button"
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

// Words shown either side of the hovered one, so it stays in the preview in a long sentence.
const PREVIEW_WORDS_BEFORE = 10;
const PREVIEW_WORDS_AFTER = 14;

/** The hovered word's sentence, split around it, trimmed to the words near it. */
function previewAround(progress: ReadAloudProgress, chunk: number, word: number) {
  // Split the same way the player counts words, so the indexes line up.
  const words = (progress.chunks[chunk] ?? "").split(/\s+/).filter((part) => part !== "");
  const index = Math.min(
    Math.max(word - (progress.chunkWordOffsets[chunk] ?? 0), 0),
    words.length - 1,
  );
  const start = Math.max(index - PREVIEW_WORDS_BEFORE, 0);
  const end = Math.min(index + 1 + PREVIEW_WORDS_AFTER, words.length);
  const before = words.slice(start, index).join(" ");
  const after = words.slice(index + 1, end).join(" ");
  return {
    before: `${start > 0 ? "… " : ""}${before}${before ? " " : ""}`,
    word: words[index] ?? "",
    after: `${after ? " " : ""}${after}${end < words.length ? " …" : ""}`,
  };
}

/** The progress bar. The fill follows the word being heard; arrow keys step by sentence. */
function Scrubber({ progress }: { progress: ReadAloudProgress }) {
  // The word under the pointer, its sentence, and where along the bar it is.
  const [hover, setHover] = useState<{ word: number; chunk: number; fraction: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const lastChunk = progress.chunks.length - 1;
  const currentChunk = chunkAtWord(progress, progress.word);

  const pointAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    const word = Math.min(Math.floor(fraction * progress.totalWords), progress.totalWords - 1);
    return { word, chunk: chunkAtWord(progress, word), fraction };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? currentChunk - 1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? currentChunk + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? lastChunk
              : null;
    if (target === null) return;
    event.preventDefault();
    seekReadAloud(progress.chunkWordOffsets[Math.min(Math.max(target, 0), lastChunk)] ?? 0);
  };

  const filled = progress.totalWords > 0 ? (progress.word / progress.totalWords) * 100 : 0;
  const preview = hover ? previewAround(progress, hover.chunk, hover.word) : null;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={1}
      aria-valuemax={lastChunk + 1}
      aria-valuenow={currentChunk + 1}
      aria-valuetext={`Sentence ${currentChunk + 1} of ${lastChunk + 1}`}
      className="group/scrub relative flex h-6 min-w-0 flex-1 cursor-pointer touch-none items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        setHover(pointAt(event));
      }}
      onPointerMove={(event) => setHover(pointAt(event))}
      onPointerUp={(event) => {
        if (!dragging) return;
        setDragging(false);
        seekReadAloud(pointAt(event).word);
      }}
      onPointerCancel={() => setDragging(false)}
      onPointerLeave={() => {
        if (!dragging) setHover(null);
      }}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted-foreground/20 group-hover/scrub:h-1.5">
        <div className="absolute inset-y-0 start-0 bg-primary" style={{ width: `${filled}%` }} />
        {hover ? (
          <div
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/60"
            style={{ left: `${hover.fraction * 100}%` }}
          />
        ) : null}
      </div>
      {preview ? (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-full z-50 mb-2 w-max max-w-72 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md"
          style={{ left: `clamp(9rem, ${hover!.fraction * 100}%, calc(100% - 9rem))` }}
        >
          <span className="line-clamp-3">
            {preview.before}
            <mark className="rounded-sm bg-primary/20 px-0.5 font-medium text-foreground">
              {preview.word}
            </mark>
            {preview.after}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Whether the word being read is in sight, so the bar offers to jump there only when it isn't. */
function useWordInView(progress: ReadAloudProgress | null) {
  const [inView, setInView] = useState(true);
  const word = progress?.word;
  useEffect(() => {
    if (word === undefined) return;
    const check = () => setInView(isReadAloudWordInView());
    check();
    // Scroll events don't bubble; capturing catches the chat list's.
    document.addEventListener("scroll", check, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", check, { capture: true });
  }, [word]);
  return inView;
}

export function ReadAloudPlayerBar({ routeThreadRef }: { routeThreadRef: ScopedThreadRef }) {
  const state = useReadAloudState();
  const progress = useReadAloudProgress();
  const [, saveSpeed] = useReadAloudSpeed();
  const router = useRouter();
  const elsewhere = state.status !== "idle" && state.threadKey !== scopedThreadKey(routeThreadRef);
  const inView = useWordInView(progress);
  if (state.status === "idle" || !progress) return null;

  const atEnd = chunkAtWord(progress, progress.word) >= progress.chunks.length - 1;

  const show = async () => {
    const threadRef = elsewhere ? parseScopedThreadKey(state.threadKey) : null;
    if (threadRef) {
      await router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    }
    await revealReadAloud();
  };

  const changeSpeed = (speed: number) => {
    saveSpeed(speed);
    setReadAloudSpeed(speed);
  };

  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root data-read-aloud-player="true">
        <ComposerBanner.Row>
          <ComposerBanner.Content className="gap-0.5">
            <Control label="Previous sentence" onClick={() => skipReadAloud(-1)}>
              <SkipBackIcon className="fill-current" />
            </Control>
            {state.status === "loading" ? (
              // Still pauses: a seek loads its sentence first, and this is where you'd stop it.
              <Control label="Pause" onClick={pauseReadAloud}>
                <Spinner size="xs" />
              </Control>
            ) : state.status === "paused" ? (
              <Control label="Resume" onClick={resumeReadAloud}>
                <PlayIcon className="fill-current" />
              </Control>
            ) : (
              <Control label="Pause" onClick={pauseReadAloud}>
                <PauseIcon className="fill-current" />
              </Control>
            )}
            <Control label="Next sentence" disabled={atEnd} onClick={() => skipReadAloud(1)}>
              <SkipForwardIcon className="fill-current" />
            </Control>
            {state.status === "loading" && state.downloadPercent !== null ? (
              // The first use downloads the model; say so instead of a bare spinner.
              <span className="flex-1 px-2 text-muted-foreground tabular-nums">
                Downloading voice {state.downloadPercent}%
              </span>
            ) : (
              <span className="flex min-w-0 flex-1 px-2">
                <Scrubber progress={progress} />
              </span>
            )}
          </ComposerBanner.Content>
          <ComposerBanner.Actions className="gap-0.5">
            <Menu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={<Button aria-label="Speed" size="xs" variant="ghost-muted" />}
                    />
                  }
                >
                  <span className="tabular-nums">{formatSpeed(progress.speed)}</span>
                </TooltipTrigger>
                <TooltipPopup side="top">Speed</TooltipPopup>
              </Tooltip>
              <MenuPopup side="top" align="end">
                <MenuRadioGroup
                  value={progress.speed}
                  onValueChange={(value) => changeSpeed(Number(value))}
                >
                  {SPEEDS.map((speed) => (
                    <MenuRadioItem key={speed} value={speed} closeOnClick>
                      {formatSpeed(speed)}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
            {elsewhere || !inView ? (
              <Button size="xs" variant="ghost-muted" onClick={() => void show()}>
                <LocateFixedIcon />
                {elsewhere ? "Go to chat" : "Jump to reading"}
              </Button>
            ) : null}
            <Control label="Stop reading" onClick={stopReadAloud}>
              <XIcon />
            </Control>
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
