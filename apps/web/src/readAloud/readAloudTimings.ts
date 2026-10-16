// Personal build: turns Kokoro's per-phoneme durations into per-word times.

export type WordTiming = { readonly start: number; readonly end: number };

type Span = { readonly start: number; readonly end: number; readonly weight: number };

/**
 * Times, in seconds of audio, for each whitespace-separated word of `text`.
 *
 * Kokoro reports how many frames each phoneme token lasts; a space token ends
 * a spoken word. Spoken and written words usually line up one to one. When they
 * don't ("612" is said as three words), written words are spread over the
 * spoken ones by their share of the sentence.
 */
export function wordTimings(input: {
  readonly text: string;
  readonly tokenIds: readonly number[];
  readonly durations: readonly number[];
  readonly spaceTokenId: number;
  readonly padTokenId: number;
  readonly secondsPerFrame: number;
}): WordTiming[] {
  const { tokenIds, durations, spaceTokenId, padTokenId, secondsPerFrame } = input;
  const written = input.text.split(/\s+/).filter((word) => word !== "");

  const spoken: Span[] = [];
  let frame = 0;
  let current: { start: number; end: number; tokens: number } | null = null;
  for (let index = 0; index < tokenIds.length; index += 1) {
    const id = tokenIds[index];
    const duration = durations[index] ?? 0;
    if (id === spaceTokenId || id === padTokenId) {
      if (current) spoken.push({ start: current.start, end: current.end, weight: current.tokens });
      current = null;
    } else {
      current ??= { start: frame, end: frame, tokens: 0 };
      current.end = frame + duration;
      current.tokens += 1;
    }
    frame += duration;
  }
  if (current) spoken.push({ start: current.start, end: current.end, weight: current.tokens });

  const toSeconds = (timing: WordTiming) => ({
    start: timing.start * secondsPerFrame,
    end: timing.end * secondsPerFrame,
  });

  if (spoken.length === 0) return written.map(() => ({ start: 0, end: 0 }));
  if (spoken.length === written.length) return spoken.map(toSeconds);

  // Map a position along the sentence (0 to 1) to a frame, walking spoken words.
  const totalWeight = spoken.reduce((sum, span) => sum + span.weight, 0);
  const frameAt = (fraction: number) => {
    let passed = 0;
    for (const span of spoken) {
      const share = span.weight / totalWeight;
      if (fraction <= passed + share) {
        return span.start + ((fraction - passed) / share) * (span.end - span.start);
      }
      passed += share;
    }
    return spoken.at(-1)!.end;
  };
  const totalChars = written.reduce((sum, word) => sum + word.length, 0);
  let chars = 0;
  return written.map((word) => {
    const start = frameAt(chars / totalChars);
    chars += word.length;
    return toSeconds({ start, end: frameAt(chars / totalChars) });
  });
}
