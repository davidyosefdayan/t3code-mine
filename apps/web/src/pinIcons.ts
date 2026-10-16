import { useSyncExternalStore } from "react";

// Emoji icons for pinned threads (my-tweaks). Stored locally by thread key;
// they are personal decoration, so they are not synced to the server.
const STORAGE_KEY = "t3code:pin-icons";
const listeners = new Set<() => void>();
let cache: Readonly<Record<string, string>> | null = null;

function read(): Readonly<Record<string, string>> {
  if (cache !== null) return cache;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    cache = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function setPinIcon(threadKey: string, emoji: string | null): void {
  const next = { ...read() };
  if (emoji === null) delete next[threadKey];
  else next[threadKey] = emoji;
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep the in-memory value for this session.
  }
  for (const listener of listeners) listener();
}

export function usePinIcon(threadKey: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read()[threadKey] ?? null,
    () => null,
  );
}

// Values are either "icon:<name>[@<color>]" (a line icon from PIN_LINE_ICONS)
// or an emoji. Each emoji carries the words the picker's search matches.
export const PIN_EMOJI_CHOICES: ReadonlyArray<readonly [string, string]> = [
  ["📚", "books"],
  ["🎨", "palette art"],
  ["✉️", "mail envelope"],
  ["🔀", "shuffle merge"],
  ["🚀", "rocket launch"],
  ["🛠️", "tools"],
  ["🐛", "bug"],
  ["📈", "chart growth"],
  ["💡", "idea bulb"],
  ["📝", "memo notes"],
  ["📸", "camera photo"],
  ["🎬", "film clapper"],
  ["🏠", "home house"],
  ["💬", "chat speech"],
  ["🧪", "test tube lab"],
  ["🔒", "lock"],
  ["⚙️", "gear settings"],
  ["📦", "package box"],
  ["🌐", "globe web"],
  ["📣", "megaphone"],
  ["🗂️", "dividers files"],
  ["🧭", "compass"],
  ["⭐", "star"],
  ["🔥", "fire"],
  ["🌿", "herb leaf"],
  ["🌸", "blossom flower"],
  ["🍀", "clover luck"],
  ["🌊", "wave ocean"],
  ["☀️", "sun"],
  ["🌙", "moon"],
  ["🍋", "lemon"],
  ["🫐", "blueberries"],
  ["🧠", "brain"],
  ["🤖", "robot"],
  ["💳", "credit card"],
  ["📅", "calendar"],
  ["💻", "laptop computer"],
  ["📱", "phone mobile"],
  ["🖥️", "desktop monitor"],
  ["🎯", "target goal"],
  ["🏆", "trophy"],
  ["🎁", "gift"],
  ["🎵", "music note"],
  ["🎧", "headphones"],
  ["🎙️", "microphone podcast"],
  ["📺", "tv"],
  ["🎮", "game controller"],
  ["📖", "book open"],
  ["📰", "newspaper"],
  ["🔍", "search magnifier"],
  ["🔑", "key"],
  ["🛡️", "shield"],
  ["💰", "money bag"],
  ["🧾", "receipt"],
  ["📊", "bar chart"],
  ["⏰", "alarm clock"],
  ["⏳", "hourglass"],
  ["✅", "check done"],
  ["📌", "pin"],
  ["🔗", "link"],
  ["📎", "paperclip"],
  ["✏️", "pencil"],
  ["🖌️", "paintbrush"],
  ["🧩", "puzzle"],
  ["🌍", "earth world"],
  ["✈️", "airplane travel"],
  ["🚗", "car"],
  ["🏔️", "mountain"],
  ["🌲", "tree"],
  ["🌈", "rainbow"],
  ["❄️", "snowflake"],
  ["☕", "coffee"],
  ["🍕", "pizza"],
  ["🍎", "apple"],
  ["🐶", "dog"],
  ["🐱", "cat"],
  ["🐟", "fish"],
  ["🦋", "butterfly"],
  ["❤️", "heart"],
  ["✨", "sparkles"],
  ["👋", "wave hello"],
  ["🙏", "pray thanks"],
  ["👥", "people team"],
  ["🎓", "graduation school"],
  ["🏢", "office building"],
  ["🏪", "store shop"],
  ["🛒", "cart shopping"],
];
