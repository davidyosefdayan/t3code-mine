import { ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentShell } from "./shell";

type ConnectionRuntime = typeof connectionAtomRuntime;
type RuntimeServices =
  ConnectionRuntime extends Atom.AtomRuntime<infer Services, infer _Error> ? Services : never;
type RuntimeError =
  ConnectionRuntime extends Atom.AtomRuntime<infer _Services, infer Error> ? Error : never;

// Personal build: annotated because the fork's extra RPC methods push the
// inferred type past the length TypeScript will serialize.
export const orchestrationEnvironment: ReturnType<
  typeof createOrchestrationEnvironmentAtoms<RuntimeServices, RuntimeError>
> = createOrchestrationEnvironmentAtoms(connectionAtomRuntime, {
  shellState: environmentShell.stateValueAtom,
});

export const threadTitlesRead = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:orchestration:thread-titles-read",
  tag: ORCHESTRATION_V2_WS_METHODS.getThreadTitles,
});
