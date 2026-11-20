// Personal build: a fork build run by the boot service installs each newer fork release on its own,
// through the same path as "Update server", once no chat on this server is running.
import { ServerSelfUpdateError } from "@t3tools/contracts";
import { forkBuildOf } from "@t3tools/shared/cliRelease";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient } from "effect/http";

import { resolveNewestVersion } from "../cli/update.ts";
import * as ServerConfig from "../config.ts";
import { forkBuildUpdate, RUNTIME_VERSION } from "../forkBuild.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSelfUpdate } from "./selfUpdate.ts";
import * as ServiceLauncherClient from "./serviceLauncherClient.ts";
import {
  compareExactServiceVersions,
  parseServiceState,
  SERVICE_STATE_FILE,
  type ServiceUpdateRecord,
} from "./serviceProtocol.ts";

const CHECK_INTERVAL = Duration.hours(1);
const BUSY_REASON = "A chat started, so the update waits until no chat is running.";

/**
 * Whether `newest` should replace the running fork build. A build the launcher already tried and
 * went back from is left to the manual paths, or every check would restart the server again.
 */
export function forkUpdateDue(input: {
  readonly running: string;
  readonly newest: string | undefined;
  readonly lastUpdate: ServiceUpdateRecord | undefined;
}): input is {
  readonly running: string;
  readonly newest: string;
  readonly lastUpdate: ServiceUpdateRecord | undefined;
} {
  if (forkBuildOf(input.running) === undefined || input.newest === undefined) return false;
  if (compareExactServiceVersions(input.newest, input.running) <= 0) return false;
  const last = input.lastUpdate;
  return !(
    last?.targetVersion === input.newest &&
    (last.status === "rolled-back" || last.status === "failed")
  );
}

export interface ForkAutoUpdateInput {
  readonly runningVersion: string;
  /** The newest fork build, or undefined when the releases cannot be read. */
  readonly newestVersion: Effect.Effect<string | undefined>;
  readonly lastUpdate: Effect.Effect<ServiceUpdateRecord | undefined>;
  readonly isBusy: Effect.Effect<boolean>;
  /** Whether a chat is running now, then again each time runs change. */
  readonly busy: Stream.Stream<boolean>;
  readonly selfUpdate: Pick<ServerSelfUpdate["Service"], "update">;
  /** What the environment descriptor offers clients as an update. */
  readonly offered: Ref.Ref<string | undefined>;
}

/**
 * One check: stage a newer fork build in the background, wait until no chat is running, then hand
 * it to the launcher. A chat that starts while the staged runtime is checked again sends it back
 * to waiting, so the switch never cuts one off.
 */
export const checkForForkUpdate = Effect.fn("ForkAutoUpdate.check")(function* (
  input: ForkAutoUpdateInput,
) {
  const newest = yield* input.newestVersion;
  const candidate = { running: input.runningVersion, newest, lastUpdate: yield* input.lastUpdate };
  if (!forkUpdateDue(candidate)) return "current" as const;
  const targetVersion = candidate.newest;

  const staged = yield* input.selfUpdate.update({ targetVersion, stageOnly: true }).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      Effect.logWarning("Could not prepare the newer fork build.", { targetVersion, error }).pipe(
        Effect.as(false),
      ),
    ),
  );
  if (!staged) return "failed" as const;
  yield* Ref.set(input.offered, targetVersion);
  yield* Effect.logInfo("A newer fork build is ready; it installs once no chat is running.", {
    targetVersion,
  });

  while (true) {
    yield* input.busy.pipe(
      Stream.filter((busy) => !busy),
      Stream.runHead,
    );
    const startedChat = yield* Ref.make(false);
    const exit = yield* input.selfUpdate
      .update({ targetVersion }, (stage) =>
        stage !== "installing"
          ? Effect.void
          : input.isBusy.pipe(
              Effect.flatMap((busy) =>
                busy
                  ? Ref.set(startedChat, true).pipe(
                      Effect.andThen(
                        Effect.fail(new ServerSelfUpdateError({ reason: BUSY_REASON })),
                      ),
                    )
                  : Effect.void,
              ),
            ),
      )
      .pipe(Effect.exit);
    if (Exit.isSuccess(exit)) return "installing" as const;
    if (!(yield* Ref.get(startedChat))) {
      yield* Effect.logWarning("Could not install the newer fork build.", {
        targetVersion,
        cause: exit.cause,
      });
      return "failed" as const;
    }
  }
});

/** Whether a chat is running: a restart would cut off a run that is queued, starting or running.
 * A queue the user held waits for them, not this server. */
export const hasActiveRuns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly active: number }>`
    SELECT EXISTS (
      SELECT 1 FROM orchestration_v2_projection_runs
      WHERE status IN ('queued', 'preparing', 'starting', 'running', 'waiting')
        AND NOT (status = 'queued' AND json_extract(payload_json, '$.queueHeld') IS 1)
    ) AS active
  `;
  return rows[0]?.active === 1;
});

const retryBackoff = Schedule.exponential("5 seconds").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.minutes(10))),
  ),
);

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const launcher = yield* ServiceLauncherClient.ServiceLauncherClient;
    const policy = yield* ManagedPolicy.ManagedPolicy;
    // Desktop-managed servers update with the app; builds without a fork release never do on
    // their own; an organization that manages updates decides them itself.
    if (
      config.mode === "desktop" ||
      !launcher.managed ||
      forkBuildOf(RUNTIME_VERSION) === undefined ||
      policy.document?.limits?.updates !== undefined
    ) {
      return;
    }
    const selfUpdate = yield* ServerSelfUpdate;
    const events = yield* OrchestrationEventStore.OrchestrationEventStore;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    const environment = yield* HostProcess.Environment;

    const sql = yield* SqlClient.SqlClient;
    const isBusy = hasActiveRuns.pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.tapCause((cause) =>
        Effect.logWarning("Fork updater could not read active runs", { cause }),
      ),
      Effect.retry(retryBackoff),
      // The retry never stops, so no error is left.
      Effect.orDie,
    );
    // Read the cursor before the snapshot so a run changing in between is replayed, not missed.
    const busy = Stream.unwrap(
      events.latestApplicationSequence.pipe(
        Effect.map((afterSequence) =>
          Stream.concat(
            Stream.succeed(undefined),
            events
              .streamApplicationEvents({ afterSequence })
              .pipe(
                Stream.filter(
                  (stored) =>
                    "event" in stored &&
                    (stored.event.type === "run.created" || stored.event.type === "run.updated"),
                ),
              ),
          ),
        ),
      ),
    ).pipe(
      Stream.mapEffect(() => isBusy),
      Stream.tapCause((cause) =>
        Effect.logWarning("Fork updater run event stream failed", { cause }),
      ),
      Stream.retry(retryBackoff),
      Stream.orDie,
    );

    const input: ForkAutoUpdateInput = {
      runningVersion: RUNTIME_VERSION,
      newestVersion: resolveNewestVersion("stable", true).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(HostProcess.Environment, environment),
        Effect.catch((error) =>
          Effect.logWarning("Could not look for a newer fork build.", { error }).pipe(
            Effect.as(undefined),
          ),
        ),
      ),
      lastUpdate: fs.readFileString(path.join(config.baseDir, "runtime", SERVICE_STATE_FILE)).pipe(
        Effect.option,
        Effect.map((text) =>
          Option.isSome(text) ? parseServiceState(text.value)?.update : undefined,
        ),
      ),
      isBusy,
      busy,
      selfUpdate,
      offered: forkBuildUpdate,
    };

    yield* forkParked(
      checkForForkUpdate(input).pipe(
        Effect.catchCause((cause) => Effect.logWarning("Fork update check failed", { cause })),
        Effect.andThen(Effect.sleep(CHECK_INTERVAL)),
        Effect.forever,
      ),
    );
  }),
);
