// Personal build: puts read aloud in the system's Now Playing, so the
// keyboard's media keys, headphone controls, and Control Center pause, resume,
// and skip it through the player like the bar does. Handlers are only set
// while something is being read; afterwards the keys go back to other apps.

type Handlers = {
  readonly play: () => void;
  readonly pause: () => void;
  readonly previous: () => void;
  readonly next: () => void;
  readonly stop: () => void;
};

const TITLE_LENGTH = 80;

function mediaSession(): MediaSession | null {
  return typeof navigator !== "undefined" && "mediaSession" in navigator
    ? navigator.mediaSession
    : null;
}

/** Claims Now Playing for an answer, titled with its opening words. */
export function claimMediaSession(firstSentence: string, handlers: Handlers) {
  const media = mediaSession();
  if (!media) return;
  const title =
    firstSentence.length > TITLE_LENGTH
      ? `${firstSentence.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
      : firstSentence;
  media.metadata = new MediaMetadata({ title, artist: "Read aloud", album: "T3 Code" });
  const set = (action: MediaSessionAction, handler: (() => void) | null) => {
    try {
      media.setActionHandler(action, handler);
    } catch {
      // An action this browser doesn't support.
    }
  };
  set("play", handlers.play);
  set("pause", handlers.pause);
  set("previoustrack", handlers.previous);
  set("nexttrack", handlers.next);
  set("stop", handlers.stop);
  // Not offered: there's no fixed duration to seek in, as sentences are made as it reads.
  set("seekbackward", null);
  set("seekforward", null);
  set("seekto", null);
}

export function setMediaSessionPlaying(playing: boolean) {
  const media = mediaSession();
  if (media) media.playbackState = playing ? "playing" : "paused";
}

/** Hands Now Playing and the media keys back. */
export function releaseMediaSession() {
  const media = mediaSession();
  if (!media) return;
  media.metadata = null;
  media.playbackState = "none";
  for (const action of [
    "play",
    "pause",
    "previoustrack",
    "nexttrack",
    "stop",
  ] as const satisfies readonly MediaSessionAction[]) {
    try {
      media.setActionHandler(action, null);
    } catch {
      // An action this browser doesn't support.
    }
  }
}
