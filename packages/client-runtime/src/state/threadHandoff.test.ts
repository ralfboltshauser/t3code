import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { incomingMoveRecoveryCommand } from "./threadHandoff.ts";

describe("incoming move recovery commands", () => {
  it.each(["safe-id", "bad;command", "../outside", "bad\ncommand", "-option"])(
    "keeps %j shell input bounded to a generated ref",
    (handoffId) => {
      const origin = {
        environmentId: EnvironmentId.make("source"),
        threadId: ThreadId.make("source"),
        handoffId,
        fingerprint: "test",
        incomingSnapshot: {
          snapshot: "a".repeat(40),
          ref: `refs/t3code/moves/${handoffId}/incoming`,
        },
      };
      const command = incomingMoveRecoveryCommand(origin);
      if (handoffId === "safe-id" || handoffId === "-option")
        expect(command).toBe(
          `git worktree add --detach ../t3-move-recovery-${handoffId} refs/t3code/moves/${handoffId}/incoming`,
        );
      else expect(command).toBeNull();
      expect(
        incomingMoveRecoveryCommand({
          ...origin,
          incomingSnapshot: { ...origin.incomingSnapshot, ref: "untrusted; command" },
        }),
      ).toBeNull();
    },
  );
});
