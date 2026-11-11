import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createThreadHandoffEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    options: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "thread-move:options",
      tag: WS_METHODS.threadHandoffOptions,
    }),
    start: createEnvironmentRpcCommand(runtime, {
      label: "thread-move:start",
      tag: WS_METHODS.threadHandoffStart,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => `${environmentId}:${input.threadId}`,
      },
    }),
    retry: createEnvironmentRpcCommand(runtime, {
      label: "thread-move:retry",
      tag: WS_METHODS.threadHandoffRetry,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => `${environmentId}:${input.threadId}`,
      },
    }),
  };
}
