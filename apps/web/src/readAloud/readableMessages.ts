// Personal build: the answers that can be read aloud right now (those showing a
// speaker), so the selection toolbar's Listen button knows the text to read.
const readable = new Map<string, { readonly threadKey: string; readonly text: string }>();

export function registerReadableMessage(messageId: string, threadKey: string, text: string) {
  const entry = { threadKey, text };
  readable.set(messageId, entry);
  return () => {
    if (readable.get(messageId) === entry) readable.delete(messageId);
  };
}

export function readableMessage(messageId: string) {
  return readable.get(messageId) ?? null;
}
