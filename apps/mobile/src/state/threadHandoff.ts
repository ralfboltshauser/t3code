import { createThreadHandoffEnvironmentAtoms } from "@t3tools/client-runtime/state/threadHandoff";
import { connectionAtomRuntime } from "../connection/runtime";
export const threadHandoffEnvironment = createThreadHandoffEnvironmentAtoms(connectionAtomRuntime);
