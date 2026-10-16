// index.html paints a splash inside #root that React's first commit would
// clear. holdBootSplash lifts it over the page just before that commit, and
// the root route releases it once the first data has landed, so startup goes
// from splash to a complete window instead of filling in piece by piece. The
// limit keeps a slow or unreachable server from stranding the splash.
const HOLD_LIMIT_MS = 2500;
// After the data lands, views still fill in from their own requests (route
// chunks, the composer, git status). Uncover once the page has stopped
// changing for this long.
const SETTLE_QUIET_MS = 120;

let held: HTMLElement | null = null;
let stopWatching: (() => void) | null = null;

export function holdBootSplash(): void {
  const shell = document.getElementById("boot-shell");
  if (!shell) return;
  Object.assign(shell.style, { position: "fixed", inset: "0", zIndex: "2147483647" });
  document.body.append(shell);
  held = shell;
  window.setTimeout(uncover, HOLD_LIMIT_MS);
}

export function releaseBootSplash(): void {
  const shell = held;
  if (!shell || stopWatching) return;
  let quietTimer = window.setTimeout(uncover, SETTLE_QUIET_MS);
  const observer = new MutationObserver((records) => {
    if (records.every((record) => shell.contains(record.target))) return;
    window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(uncover, SETTLE_QUIET_MS);
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  stopWatching = () => {
    observer.disconnect();
    window.clearTimeout(quietTimer);
  };
}

function uncover(): void {
  stopWatching?.();
  stopWatching = null;
  const shell = held;
  if (!shell) return;
  held = null;
  // Let the settled UI paint underneath before uncovering it.
  requestAnimationFrame(() => requestAnimationFrame(() => shell.remove()));
}
