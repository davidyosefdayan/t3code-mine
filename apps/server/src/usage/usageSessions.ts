/**
 * Folds parsed transcript records into per-session totals for one provider and
 * one time window: the raw material for "where did my weekly limit go".
 *
 * Pure, like `usageAggregation`, and de-duplicated the same way: Claude Code
 * copies records forward when a session resumes or forks, so the same
 * `dedupeKey` can appear in several transcripts and must count once.
 *
 * Personal build: feeds Usage → Limits ("where did my weekly limit go").
 *
 * @module usageSessions
 */
// @effect-diagnostics nodeBuiltinImport:off - reads a transcript's first bytes like usageTranscriptReader.
import * as NodeFSP from "node:fs/promises";

import type { UsageProviderKind, UsageTokenTotals } from "@t3tools/contracts";
import { EMPTY_TOTALS, type UsageRecord } from "@t3tools/provider-core/server/usage";

import { priceUsage, type RateTable } from "./usagePricing.ts";

function addTotals(left: UsageTokenTotals, right: UsageTokenTotals): UsageTokenTotals {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  };
}

const HOUR_MS = 60 * 60 * 1000;

export interface ScannedSession {
  readonly sessionId: string;
  /** The first transcript that contributed, for reading its working directory and title. */
  readonly filePath: string;
  readonly costUsd: number;
  readonly totals: UsageTokenTotals;
  readonly records: number;
  readonly models: ReadonlyArray<{ model: string; costUsd: number; records: number }>;
  /** UTC hour starts, ascending. */
  readonly hours: ReadonlyArray<{ hourStartMs: number; costUsd: number; records: number }>;
}

interface MutableSession {
  filePath: string;
  costUsd: number;
  totals: UsageTokenTotals;
  records: number;
  models: Map<string, { costUsd: number; records: number }>;
  hours: Map<number, { costUsd: number; records: number }>;
}

export interface SessionAggregateOptions {
  readonly provider: UsageProviderKind;
  readonly sinceTimeMs: number;
  readonly untilTimeMs: number;
  readonly rates: RateTable;
  readonly priceOverrides?: RateTable;
  /** From `resolveModelAliases`, so models read the same as on the Spend page. */
  readonly modelAliases?: ReadonlyMap<string, string>;
}

/** A mapped model prices as its target, like `UsageAggregator` does. */
function withModelAlias(
  record: UsageRecord,
  aliases: ReadonlyMap<string, string> | undefined,
): UsageRecord {
  const model = aliases?.get(record.model);
  if (model === undefined) return record;
  const { rateModel: _rateModel, ...rest } = record;
  return { ...rest, model };
}

export class UsageSessionAggregator {
  readonly #sessions = new Map<string, MutableSession>();
  readonly #seen = new Set<string>();
  readonly #options: SessionAggregateOptions;

  constructor(options: SessionAggregateOptions) {
    this.#options = options;
  }

  add(input: UsageRecord, filePath: string): void {
    const options = this.#options;
    const record = withModelAlias(input, options.modelAliases);
    if (record.provider !== options.provider) return;
    if (record.timestampMs < options.sinceTimeMs || record.timestampMs >= options.untilTimeMs) {
      return;
    }
    if (record.dedupeKey !== null) {
      if (this.#seen.has(record.dedupeKey)) return;
      this.#seen.add(record.dedupeKey);
    }

    // A record without a session still belongs to its transcript.
    const sessionId = record.sessionId || `file:${filePath}`;
    let session = this.#sessions.get(sessionId);
    if (session === undefined) {
      session = {
        filePath,
        costUsd: 0,
        totals: EMPTY_TOTALS,
        records: 0,
        models: new Map(),
        hours: new Map(),
      };
      this.#sessions.set(sessionId, session);
    } else if (
      session.filePath !== filePath &&
      filePath.endsWith(`${sessionId}.jsonl`) &&
      !session.filePath.endsWith(`${sessionId}.jsonl`)
    ) {
      // Subagent transcripts list before the session's own, which holds its title.
      session.filePath = filePath;
    }

    const { costUsd } = priceUsage(options.rates, record, options.priceOverrides);
    session.costUsd += costUsd;
    session.totals = addTotals(session.totals, record.totals);
    session.records += 1;

    const model = session.models.get(record.model);
    if (model) {
      model.costUsd += costUsd;
      model.records += 1;
    } else {
      session.models.set(record.model, { costUsd, records: 1 });
    }

    const hourStartMs = record.timestampMs - (record.timestampMs % HOUR_MS);
    const hour = session.hours.get(hourStartMs);
    if (hour) {
      hour.costUsd += costUsd;
      hour.records += 1;
    } else {
      session.hours.set(hourStartMs, { costUsd, records: 1 });
    }
  }

  /** Sessions by cost, most expensive first. */
  finish(): readonly ScannedSession[] {
    return [...this.#sessions]
      .map(([sessionId, session]) => ({
        sessionId,
        filePath: session.filePath,
        costUsd: session.costUsd,
        totals: session.totals,
        records: session.records,
        models: [...session.models]
          .map(([model, value]) => ({ model, ...value }))
          .sort((left, right) => right.costUsd - left.costUsd),
        hours: [...session.hours]
          .map(([hourStartMs, value]) => ({ hourStartMs, ...value }))
          .sort((left, right) => left.hourStartMs - right.hourStartMs),
      }))
      .sort((left, right) => right.costUsd - left.costUsd || right.records - left.records);
  }
}

/**
 * The working directory and title a transcript records near its start.
 * Claude writes `cwd` on every line and an `ai-title` line once it names the
 * session; Codex puts `cwd` in its opening `session_meta`.
 */
export function parseSessionHead(head: string): { cwd?: string; title?: string; origin?: string } {
  const cwd = readJsonString(head, "cwd");
  const title =
    readJsonString(head, "aiTitle") ?? readJsonString(head, "summary", '"type":"summary",');
  // Which client started it: Codex's `originator`, Claude's `entrypoint`.
  const origin = readJsonString(head, "originator") ?? readJsonString(head, "entrypoint");
  return {
    ...(cwd ? { cwd } : {}),
    ...(origin ? { origin } : {}),
    ...(title ? { title: title.trim() } : {}),
  };
}

function readJsonString(text: string, key: string, prefix = ""): string | undefined {
  const match = new RegExp(`${prefix}"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
  if (!match) return undefined;
  try {
    const value = JSON.parse(`"${match[1]}"`) as string;
    return value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Codex's `session_index.jsonl`: the newest name per thread id. */
export function parseCodexSessionIndex(text: string): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { id?: unknown; thread_name?: unknown };
      if (typeof entry.id === "string" && typeof entry.thread_name === "string") {
        const name = entry.thread_name.trim();
        if (name) names.set(entry.id, name);
      }
    } catch {
      // A torn final line is expected while Codex writes.
    }
  }
  return names;
}

const NEWLINE = 0x0a;

/**
 * The first `bytes` of a file as text, or `null` when it cannot be read. Only
 * complete lines are returned so a JSON value is never cut in half.
 */
export async function readFileHead(filePath: string, bytes = 128 * 1024): Promise<string | null> {
  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    const chunk = buffer.subarray(0, bytesRead);
    const lastNewline = bytesRead === bytes ? chunk.lastIndexOf(NEWLINE) : bytesRead;
    return chunk.subarray(0, lastNewline < 0 ? bytesRead : lastNewline).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
