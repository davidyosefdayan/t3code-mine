import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

// Personal build: Siri voices for read aloud, spoken by the server's Mac.
export const readAloudVoiceEnvironment = {
  voices: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:read-aloud:voices",
    tag: WS_METHODS.serverGetReadAloudVoices,
  }),
  speak: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:read-aloud:speak",
    tag: WS_METHODS.serverReadAloudSpeak,
  }),
};
