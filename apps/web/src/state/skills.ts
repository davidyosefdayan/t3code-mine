import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

// Personal build: the Skills page's calls to manage skills on an environment.
export const skillsEnvironment = {
  create: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:skills:create",
    tag: WS_METHODS.skillsCreate,
  }),
  save: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:skills:save",
    tag: WS_METHODS.skillsSave,
  }),
  setEnabled: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:skills:set-enabled",
    tag: WS_METHODS.skillsSetEnabled,
  }),
  share: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:skills:share",
    tag: WS_METHODS.skillsShare,
  }),
  delete: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:skills:delete",
    tag: WS_METHODS.skillsDelete,
  }),
};
