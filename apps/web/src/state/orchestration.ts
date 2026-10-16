import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import type { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

type ConnectionRuntime = typeof connectionAtomRuntime;
type RuntimeServices =
  ConnectionRuntime extends Atom.AtomRuntime<infer Services, infer _Error> ? Services : never;
type RuntimeError =
  ConnectionRuntime extends Atom.AtomRuntime<infer _Services, infer Error> ? Error : never;

// Personal build: annotated because the fork's extra RPC methods push the
// inferred type past the length TypeScript will serialize.
export const orchestrationEnvironment: ReturnType<
  typeof createOrchestrationEnvironmentAtoms<RuntimeServices, RuntimeError>
> = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);
