import { Icon, type IconNode, type LucideProps } from "lucide-react";

// Lucide's scroll-text, plus a stroke-less silhouette of the scroll's sheet
// with its two text lines cut out (evenodd). Only the sheet fills; the rolls
// at the top-left and bottom stay outlined. The silhouette stays invisible
// until a parent fills it and hides the stroked lines
// (`[&_[data-fill]]:fill-current [&_[data-text]]:opacity-0`), which is how
// the rail marks the Skills page as active.
const SCROLL_SILHOUETTE = [
  // Sheet, from the top edge down to where the bottom roll begins.
  "M4 3h13a2 2 0 0 1 2 2v12H6V5a2 2 0 0 0-2-2Z",
  // Text lines, cut out.
  "M10 7h5a1 1 0 0 1 0 2h-5a1 1 0 0 1 0-2Z",
  "M10 11h5a1 1 0 0 1 0 2h-5a1 1 0 0 1 0-2Z",
].join("");

const skillsScroll: IconNode = [
  [
    "path",
    { d: SCROLL_SILHOUETTE, stroke: "none", fillRule: "evenodd", "data-fill": "", key: "fill" },
  ],
  ["path", { d: "M15 12h-5", "data-text": "", key: "line-2" }],
  ["path", { d: "M15 8h-5", "data-text": "", key: "line-1" }],
  ["path", { d: "M19 17V5a2 2 0 0 0-2-2H4", key: "sheet" }],
  [
    "path",
    {
      d: "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",
      key: "rolls",
    },
  ],
];

/** The Skills page's icon: a scroll, like the one the provider apps use. */
export function SkillsIcon(props: LucideProps) {
  return <Icon iconNode={skillsScroll} {...props} />;
}
