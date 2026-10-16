// Personal build: turns the start of an agent reply into a one-line preview
// for the sidebar, like a messages app: markdown markers dropped, links and
// code reduced to their text, whitespace collapsed.
export function sidebarMessagePreview(text: string | null | undefined): string | null {
  if (!text) return null;
  const plain = text
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 0 ? plain : null;
}
