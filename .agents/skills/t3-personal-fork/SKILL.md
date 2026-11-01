---
name: t3-personal-fork
description: Build personal customizations in ralfboltshauser/t3code, integrate upstream updates, or deploy the fork to the local Ubuntu installation.
---

Read `FORK.md` before changing this fork. `personal` is the maintained version;
`main` is an upstream mirror. Keep changes in the fork unless Ralf requests an
upstream contribution.

## Building a customization

1. Fetch `origin personal` and inspect the working tree and branch history.
   Fast-forward a clean `personal` branch when possible. Preserve unfinished work;
   use a sibling worktree from `origin/personal` for independent changes. Inspect
   and merge diverged local commits rather than resetting them away.
2. Put substantial personal behavior in its own module and connect it through
   the smallest practical edit to upstream code. Follow upstream refactors when
   adapting the behavior; keeping their old internals creates recurring conflicts.
3. Update the intentional-differences section of `FORK.md` with the behavior,
   reason, owning paths, and focused verification command or manual procedure.
   This records what future updates must preserve, including deliberate removals.
4. Verify the affected behavior and run `vp run check:changed upstream/main`.
   Publish completed changes to `personal` with a normal push when authorized.

## Upstream updates

The daily launcher supplies an exact upstream commit and a detached candidate
worktree. Work only there; the development checkout may contain unfinished work.

1. Read the intentional differences and inspect the upstream changes affecting
   their owning paths. Merge the supplied commit with an ordinary Git merge so
   the next update retains the shared ancestry.
2. Resolve conflicts by combining the intended behavior with upstream's new
   structure. Preserve upstream correctness and security fixes. When the two
   behaviors cannot be reconciled from source and `FORK.md`, stop and identify
   the decision needed instead of guessing or selecting an entire side.
3. Run every applicable customization check from `FORK.md`, including checks for
   intentionally removed behavior. A conflict-free merge can still break it.
   Repair failures without deleting assertions merely to make checks pass.
4. Commit the merge and any repairs. Report the upstream commit, conflict
   decisions, checks and results, and anything unverified. The launcher separately
   runs `check:changed` before publishing; do not push from the agent session.

If a check fails or intent is uncertain, leave a failing candidate for inspection:
write `.personal-sync-blocked` with the reason and summarize it in the final
report. The launcher checks for this file before publishing, even if the agent
process exits successfully. Keep it out of commits; remove it after the blocker
is resolved and its checks pass.

## Local installation

Follow [Updating the local installation](../../../FORK.md#updating-the-local-installation)
when asked to build, install, update, or roll back the running fork. A source push
and a deployment have separate completion criteria.

1. Compare the selected source SHA with the installed release's `SOURCE_COMMIT`.
   Inspect the service and its actual state directory before planning a cutover.
2. Prepare and smoke-test a release from a clean, checked commit using isolated
   state. Keep the current service running while building. If a build or check
   fails, retain the current release and report the failure.
3. Activate only within the requested deployment scope and after active turns
   have stopped. Follow the guide's cutover and recovery procedure; hand off a
   restart that would terminate this conversation's server.
4. Verify startup and the affected behavior in a real client. Report the installed
   source SHA, checks performed, and anything unverified. If only source was
   published, say that the running installation has not been updated.
