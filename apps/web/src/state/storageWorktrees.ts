import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

// Personal build: the worktree list in Settings → Storage.
export const storageWorktreesEnvironment = {
  list: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "environment-data:server:storage-worktrees",
    tag: WS_METHODS.serverGetStorageWorktrees,
    idleTtlMs: 0,
  }),
  freePackages: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:server:free-storage-worktree-packages",
    tag: WS_METHODS.serverFreeStorageWorktreePackages,
  }),
  delete: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:server:delete-storage-worktree",
    tag: WS_METHODS.serverDeleteStorageWorktree,
  }),
};
