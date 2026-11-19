// Personal build: the fork release this server was built for. release-mine.yml passes it as
// T3CODE_FORK_VERSION, and the server bundle embeds it (vite.config.ts).
import { forkRuntimeVersion } from "@t3tools/shared/cliRelease";
import * as Ref from "effect/Ref";

import packageJson from "../package.json" with { type: "json" };

declare const __T3CODE_FORK_VERSION__: string | undefined;

/**
 * `0.1.10+1003` for a server built for fork release 0.1.1003, and upstream's version for any
 * other build. Runtimes are installed, launched and compared by it; clients still see upstream's.
 */
export const RUNTIME_VERSION =
  forkRuntimeVersion(
    packageJson.version,
    typeof __T3CODE_FORK_VERSION__ === "string" ? __T3CODE_FORK_VERSION__ : undefined,
  ) ?? packageJson.version;

/** The server manifest as the code that names, launches and compares runtimes reads it. */
export const runtimePackageJson = { ...packageJson, version: RUNTIME_VERSION };

/** A newer fork build this server's updater found and staged; its descriptor offers it to clients. */
export const forkBuildUpdate = Ref.makeUnsafe<string | undefined>(undefined);
