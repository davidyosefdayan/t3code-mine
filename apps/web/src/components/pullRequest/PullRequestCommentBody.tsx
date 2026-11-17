import { useGT } from "gt-react";
import { useId, useRef, useState, type ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { observeResize } from "~/lib/observeResize";

export function PullRequestCommentBody({
  className,
  ...props
}: ComponentProps<typeof PullRequestMarkdown>) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const clip = useRef<HTMLDivElement>(null);
  const id = useId();

  return (
    <div className={cn("min-w-0", className)}>
      <div
        ref={clip}
        id={id}
        className={cn(
          "relative",
          !expanded && "max-h-[240px] overflow-hidden",
          // Personal build: a mask, not a painted gradient, so it fades into translucent themes too.
          overflowing &&
            !expanded &&
            "[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]",
        )}
        onFocusCapture={() => setExpanded(true)}
      >
        <div
          ref={(element) => {
            if (element === null) return;
            return observeResize(element, ([entry]) => {
              if (entry) setOverflowing(entry.contentRect.height > 240);
            });
          }}
        >
          <PullRequestMarkdown {...props} />
        </div>
      </div>
      {overflowing ? (
        <Button
          size="xs"
          variant="ghost-muted"
          className="mt-2"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            if (expanded) clip.current?.scrollIntoView({ block: "nearest" });
            setExpanded(!expanded);
          }}
        >
          {expanded ? gt("Show less") : gt("Show full comment")}
        </Button>
      ) : null}
    </div>
  );
}
