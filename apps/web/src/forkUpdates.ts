import { useEffect, useSyncExternalStore } from "react";

// Two update checks for the fork (see FORK.md). The maintainer's builds look for
// a newer stable upstream T3 Code release and open a chat that moves the fork
// onto it. Everyone else's unsigned Mac builds can't update themselves, so they
// look for a newer release of the fork and open a chat that installs it.

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Folder name of the fork's checkout; the matching project gets the update chat. */
export const FORK_PROJECT_FOLDER = "T3 Code";
export const FORK_REPOSITORY = "davidyosefdayan/t3code-mine";

export interface ForkUpdate {
  readonly version: string;
  readonly url: string;
}

function parseVersion(version: string): ReadonlyArray<number> | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index]! !== now[index]!) return next[index]! > now[index]!;
  }
  return false;
}

interface CheckState {
  readonly checking: boolean;
  /** Newest stable release, as last reported by GitHub. */
  readonly latest: ForkUpdate | null;
  /** Set after a check completes, so the UI can say "up to date". */
  readonly checkedAt: number | null;
}

export interface ForkUpdateState {
  readonly checking: boolean;
  /** The latest release when it is newer than this build. */
  readonly update: ForkUpdate | null;
  readonly checkedAt: number | null;
}

export interface ReleaseCheck {
  /** Checks GitHub now. Safe to call repeatedly; overlapping checks are skipped. */
  readonly check: () => Promise<void>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => CheckState;
}

function createReleaseCheck(repository: string): ReleaseCheck {
  const latestReleaseUrl = `https://api.github.com/repos/${repository}/releases/latest`;
  // Only GitHub's answer is stored; whether it is newer is decided when read,
  // against the current version. The app briefly reports a cached version at
  // startup, so a comparison stored at check time could go stale.
  let state: CheckState = { checking: false, latest: null, checkedAt: null };
  const listeners = new Set<() => void>();
  const setState = (next: Partial<CheckState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const check = async () => {
    if (state.checking) return;
    setState({ checking: true });
    try {
      const response = await fetch(latestReleaseUrl, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) return;
      const release = (await response.json()) as { tag_name?: string; html_url?: string };
      const version = release.tag_name?.replace(/^v/, "");
      if (!version) return;
      setState({
        latest: {
          version,
          url: release.html_url ?? `https://github.com/${repository}/releases/latest`,
        },
        checkedAt: Date.now(),
      });
    } catch {
      // Offline or rate limited: the next check tries again.
    } finally {
      setState({ checking: false });
    }
  };

  return { check, subscribe, getState: () => state };
}

/** Update state, checked on mount and every few hours while mounted. */
export function useReleaseCheck(
  releaseCheck: ReleaseCheck,
  currentVersion: string | null,
): ForkUpdateState {
  const snapshot = useSyncExternalStore(releaseCheck.subscribe, releaseCheck.getState);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- interval timer polling GitHub for a newer release
  useEffect(() => {
    void releaseCheck.check();
    const interval = window.setInterval(() => void releaseCheck.check(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [releaseCheck]);
  const update =
    snapshot.latest !== null &&
    currentVersion !== null &&
    isNewerVersion(snapshot.latest.version, currentVersion)
      ? snapshot.latest
      : null;
  return { checking: snapshot.checking, update, checkedAt: snapshot.checkedAt };
}

/** Upstream's stable releases, compared to the server's (upstream) version. */
export const upstreamReleaseCheck = createReleaseCheck("pingdotgg/t3code");
/** The fork's releases, compared to the desktop app's (fork) version. */
export const forkReleaseCheck = createReleaseCheck(FORK_REPOSITORY);

/** Instructions pasted into the update chat; the maintainer reviews them before sending. */
export function forkUpdatePrompt(update: ForkUpdate, currentVersion: string): string {
  return `T3 Code v${update.version} is out (release notes: ${update.url}). This checkout is my personal fork, currently based on v${currentVersion}. Please update it to v${update.version}.

Start by reading FORK.md in this repo: it explains how the fork works, why each of our changes exists, and the update steps.

This isn't just a rebase that compiles. I want everything upstream added and fixed, and I want to keep what each of our changes is for, which isn't always the same as keeping our code. Before rebasing, go through what changed upstream and talk it through with me, sorted into:
- Changes that don't touch ours: these just come in. Tell me the highlights.
- Changes that cover what one of ours was for (a bug we fixed that they fixed too, or something we built that they now have): suggest taking theirs and dropping ours, and tell me which part of ours theirs doesn't cover, so we only carry that.
- Changes that redesign something we redesigned: I decide. Show me screenshots of their version and ours side by side, and tell me what else theirs fixes.

Once I've answered, do the update, build the Mac app, and tell me when to quit the app so the update installs.`;
}

/** Instructions pasted into the install chat on someone else's Mac; they review them before sending. */
export function forkInstallPrompt(update: ForkUpdate, currentVersion: string): string {
  const zipUrl = `https://github.com/${FORK_REPOSITORY}/releases/download/v${update.version}/T3-Code-${update.version}-arm64.zip`;
  return `T3 Code (Mine) v${update.version} is out (release notes: ${update.url}). This Mac has v${currentVersion}. Please install the update for me.

1. Download the Apple silicon build, ${zipUrl}, and unzip it with \`ditto -x -k\` into a new temporary folder. It holds \`T3 Code (Mine).app\`.
2. Don't replace the app yet: you are running inside it, and replacing it now can crash this chat. Find the app's main process, which also tells you where it's installed (normally \`/Applications/T3 Code (Mine).app\`): \`ps -axo pid=,ppid=,comm= | awk '$2 == 1 && /\\/Contents\\/MacOS\\/T3 Code \\(Mine\\)$/'\`. Write a small script that waits for that PID to exit (\`while kill -0 <pid> 2>/dev/null; do sleep 1; done\`), then replaces the installed app with the new one, runs \`xattr -cr\` and \`codesign --force --deep --sign -\` on it (the build isn't signed by Apple, so macOS would otherwise call it damaged), and opens it. Have it log to a file next to it.
3. Start the script in its own session, so it outlives the app quitting (quitting can stop this chat's whole process group, even with \`nohup\`): \`nohup /usr/bin/perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' /bin/bash <script> >/dev/null 2>&1 &\`. Check it's running.
4. Tell me to quit T3 Code (Mine) with Cmd+Q. It reopens on v${update.version} within a few seconds, and my chats and settings stay. If it doesn't reopen within a minute, tell me to install it by hand from the release page.`;
}
