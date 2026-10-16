import { useRouterState } from "@tanstack/react-router";

/**
 * The pathname of the page the router is rendering. useLocation switches as
 * soon as navigation starts, while Outlets keep the old page until the next
 * one resolves, so chrome keyed on it changes a beat before the content.
 */
export function useRenderedPathname(): string {
  return useRouterState({
    select: (state) => state.matches.at(-1)?.pathname ?? state.location.pathname,
  });
}
