export function getVisibleSidebarGroupThreads<Thread>(input: {
  readonly threads: readonly Thread[];
  readonly collapsed: boolean;
  readonly routeThreadKey: string | null;
  readonly threadKey: (thread: Thread) => string;
}): readonly Thread[] {
  if (!input.collapsed) return input.threads;
  if (input.routeThreadKey === null) return [];
  return input.threads.filter((thread) => input.threadKey(thread) === input.routeThreadKey);
}
