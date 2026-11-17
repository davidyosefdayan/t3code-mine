// Personal build: the dot on a rail button (chats waiting for you, an update).
// It takes the icon's color. The gap around it is a hole cut in the icon (index.css,
// `data-rail-dot`), so whatever is behind shows through, photo themes included.
// The button needs `relative group/rail-item`, with the icon centered.
export function RailDot() {
  return (
    <span
      aria-hidden="true"
      data-rail-dot=""
      className="absolute top-1 right-1 flex size-3 items-center justify-center"
    >
      <span className="size-2 rounded-full bg-current" />
    </span>
  );
}
