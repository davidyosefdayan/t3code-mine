import { assert, describe, it } from "@effect/vitest";
import { ServerSelfUpdateError, type ServerSelfUpdateInput } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";

import {
  checkForForkUpdate,
  type ForkAutoUpdateInput,
  forkUpdateDue,
  hasActiveRuns,
} from "./forkAutoUpdate.ts";

describe("forkUpdateDue", () => {
  it("updates a fork build to a newer fork build only", () => {
    const cases = [
      { running: "0.1.10+1003", newest: "0.1.10+1004", due: true },
      { running: "0.1.10+1003", newest: "0.1.11+1101", due: true },
      { running: "0.1.11+1101", newest: "0.1.11+1102", due: true },
      { running: "0.1.11+1102", newest: "0.1.11+1101", due: false },
      { running: "0.1.10+1003", newest: "0.1.10+1003", due: false },
      { running: "0.1.10+1004", newest: "0.1.10+1003", due: false },
      { running: "0.1.10+1003", newest: undefined, due: false },
      // A build without a fork release keeps upstream's behaviour: no automatic update.
      { running: "0.1.10", newest: "0.1.10+1004", due: false },
    ];
    for (const { running, newest, due } of cases) {
      assert.equal(forkUpdateDue({ running, newest, lastUpdate: undefined }), due, `${running}`);
    }
  });

  it("leaves a build the launcher went back from to the manual paths", () => {
    const lastUpdate = (targetVersion: string, status: "rolled-back" | "failed" | "committed") => ({
      id: "u",
      fromVersion: "0.1.10+1003",
      targetVersion,
      status,
    });
    const due = (last: ReturnType<typeof lastUpdate>) =>
      forkUpdateDue({ running: "0.1.10+1003", newest: "0.1.10+1004", lastUpdate: last });
    assert.isFalse(due(lastUpdate("0.1.10+1004", "rolled-back")));
    assert.isFalse(due(lastUpdate("0.1.10+1004", "failed")));
    assert.isTrue(due(lastUpdate("0.1.10+1005", "rolled-back")));
  });
});

describe("checkForForkUpdate", () => {
  const harness = Effect.fn(function* (options: {
    readonly running?: string;
    readonly busy: ReadonlyArray<boolean>;
    /** isBusy answers, one per install attempt. */
    readonly busyAtInstall?: ReadonlyArray<boolean>;
    readonly failStaging?: boolean;
  }) {
    const log: string[] = [];
    const busyQueue = yield* Queue.unbounded<boolean>();
    yield* Queue.offerAll(busyQueue, options.busy);
    const busyAtInstall = [...(options.busyAtInstall ?? [])];
    const offered = yield* Ref.make<string | undefined>(undefined);
    const input: ForkAutoUpdateInput = {
      runningVersion: options.running ?? "0.1.10+1003",
      newestVersion: Effect.succeed("0.1.10+1004"),
      lastUpdate: Effect.undefined,
      isBusy: Effect.sync(() => busyAtInstall.shift() ?? false),
      // One value per pull, as each wait reads the current state afresh.
      busy: Stream.fromEffectRepeat(Queue.take(busyQueue)).pipe(
        Stream.tap((busy) => Effect.sync(() => log.push(busy ? "busy" : "idle"))),
      ),
      offered,
      selfUpdate: {
        update: (request: ServerSelfUpdateInput, reportProgress = () => Effect.void) =>
          Effect.gen(function* () {
            if (request.stageOnly === true) {
              log.push(`stage ${request.targetVersion}`);
              if (options.failStaging === true) {
                return yield* new ServerSelfUpdateError({ reason: "download failed" });
              }
              return { targetVersion: request.targetVersion, method: "boot-service" as const };
            }
            log.push("install");
            yield* reportProgress("installing");
            log.push(`handoff ${request.targetVersion}`);
            return { targetVersion: request.targetVersion, method: "boot-service" as const };
          }),
      },
    };
    return { input, log, offered };
  });

  it.effect("stages the newer build at once and installs it once no chat is running", () =>
    Effect.gen(function* () {
      const { input, log, offered } = yield* harness({ busy: [true, true, false] });
      assert.equal(yield* checkForForkUpdate(input), "installing");
      assert.deepEqual(log, [
        "stage 0.1.10+1004",
        "busy",
        "busy",
        "idle",
        "install",
        "handoff 0.1.10+1004",
      ]);
      assert.equal(yield* Ref.get(offered), "0.1.10+1004");
    }),
  );

  it.effect("goes back to waiting when a chat starts before the handoff", () =>
    Effect.gen(function* () {
      const { input, log } = yield* harness({
        busy: [false, true, false],
        busyAtInstall: [true, false],
      });
      assert.equal(yield* checkForForkUpdate(input), "installing");
      assert.deepEqual(log, [
        "stage 0.1.10+1004",
        "idle",
        "install",
        "busy",
        "idle",
        "install",
        "handoff 0.1.10+1004",
      ]);
    }),
  );

  it.effect("offers nothing when staging fails, and retries on the next check", () =>
    Effect.gen(function* () {
      const { input, log, offered } = yield* harness({ busy: [false], failStaging: true });
      assert.equal(yield* checkForForkUpdate(input), "failed");
      assert.deepEqual(log, ["stage 0.1.10+1004"]);
      assert.isUndefined(yield* Ref.get(offered));
    }),
  );

  it.effect("never updates a build without a fork release", () =>
    Effect.gen(function* () {
      const { input, log } = yield* harness({ running: "0.1.10", busy: [false] });
      assert.equal(yield* checkForForkUpdate(input), "current");
      assert.deepEqual(log, []);
    }),
  );
});

const database = NodeSqliteClient.layer({ filename: ":memory:" });

it.layer(database)("hasActiveRuns", (it) => {
  it.effect("counts queued, starting and running chats, but not a held queue", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const sql = yield* SqlClient.SqlClient;
      const setRun = (status: string, payload: object = {}) =>
        sql`DELETE FROM orchestration_v2_projection_runs`.pipe(
          Effect.andThen(
            sql`
              INSERT INTO orchestration_v2_projection_runs
                (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
              VALUES ('run-1', 'thread-1', 1, 'codex', ${status}, '2026-01-01', ${JSON.stringify(payload)})
            `,
          ),
        );
      assert.isFalse(yield* hasActiveRuns);
      for (const status of ["queued", "preparing", "starting", "running", "waiting"]) {
        yield* setRun(status);
        assert.isTrue(yield* hasActiveRuns, status);
      }
      for (const status of ["completed", "interrupted", "failed", "cancelled", "rolled_back"]) {
        yield* setRun(status);
        assert.isFalse(yield* hasActiveRuns, status);
      }
      yield* setRun("queued", { queueHeld: true });
      assert.isFalse(yield* hasActiveRuns);
    }),
  );
});
