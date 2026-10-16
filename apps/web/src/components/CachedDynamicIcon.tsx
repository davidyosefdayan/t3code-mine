import { Icon, type IconNode } from "lucide-react";
import { useEffect, useState } from "react";

// lucide's DynamicIcon re-imports its icon on every mount, so each remount
// shows a fallback for a frame before the icon. This keeps every loaded icon,
// letting later mounts draw synchronously; the first load renders an empty box
// rather than a different stand-in icon.
const loadedIcons = new Map<string, IconNode>();

async function loadIconNode(name: string): Promise<IconNode | null> {
  const { dynamicIconImports } = await import("lucide-react/dynamic");
  const load = dynamicIconImports[name as keyof typeof dynamicIconImports];
  if (!load) return null;
  const node = (await load()).__iconNode as IconNode;
  loadedIcons.set(name, node);
  return node;
}

export function CachedDynamicIcon({ name, className }: { name: string; className?: string }) {
  const [node, setNode] = useState(() => loadedIcons.get(name) ?? null);
  useEffect(() => {
    const cached = loadedIcons.get(name);
    if (cached) {
      setNode(cached);
      return;
    }
    let live = true;
    void loadIconNode(name)
      .then((loaded) => {
        if (live) setNode(loaded);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [name]);
  return node ? <Icon iconNode={node} className={className} /> : <span className={className} />;
}
