import { useAtomValue } from "@effect/atom-react";
import { useEffect, useSyncExternalStore } from "react";

import { primaryServerConfigAtom } from "./state/server";

// Personal build: this app never installs upstream updates itself (it has no
// update feed). Instead it checks GitHub for a newer stable T3 Code release and
// offers to start an agent chat that moves the fork onto it (see FORK.md).

const LATEST_STABLE_RELEASE_URL = "https://api.github.com/repos/pingdotgg/t3code/releases/latest";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Folder name of the fork's checkout; the matching project gets the update chat. */
export const FORK_PROJECT_FOLDER = "T3 Code";

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
  /** Newest stable upstream release, as last reported by GitHub. */
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

// Only GitHub's answer is stored; whether it is newer is decided when read,
// against the current version. The app briefly reports a cached version at
// startup, so a comparison stored at check time could go stale.
let state: CheckState = { checking: false, latest: null, checkedAt: null };
const listeners = new Set<() => void>();
function setState(next: Partial<CheckState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** Checks GitHub now. Safe to call repeatedly; overlapping checks are skipped. */
export async function checkForForkUpdate(): Promise<void> {
  if (state.checking) return;
  setState({ checking: true });
  try {
    const response = await fetch(LATEST_STABLE_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const release = (await response.json()) as { tag_name?: string; html_url?: string };
    const version = release.tag_name?.replace(/^v/, "");
    if (!version) return;
    setState({
      latest: { version, url: release.html_url ?? LATEST_STABLE_RELEASE_URL },
      checkedAt: Date.now(),
    });
  } catch {
    // Offline or rate limited: the next check tries again.
  } finally {
    setState({ checking: false });
  }
}

/** Update state, checked at startup and every few hours while mounted. */
export function useForkUpdate(): ForkUpdateState & { readonly currentVersion: string | null } {
  const currentVersion = useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
  useEffect(() => {
    void checkForForkUpdate();
    const interval = window.setInterval(() => void checkForForkUpdate(), CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);
  const update =
    snapshot.latest !== null &&
    currentVersion !== null &&
    isNewerVersion(snapshot.latest.version, currentVersion)
      ? snapshot.latest
      : null;
  return { checking: snapshot.checking, update, checkedAt: snapshot.checkedAt, currentVersion };
}

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
