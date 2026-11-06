---
name: t3-fork-upstream
description: Integrate upstream T3 Code changes into the personal fork while preserving recorded custom behavior, identifying semantic feature overlap, and queuing ambiguous decisions for weekly review.
---

# Preserve the fork through an upstream merge

Follow [the explicit release procedure](../../../docs/operations/personal-fork.md)
for locking, pinned refs, candidates, checks, publication and release. From any
worktree, `python3 scripts/personal-fork/manage.py paths` locates the canonical
checkout and its ignored `.t3-fork/` state. Use the latest candidate's `FORK.md`
and source instructions rather than a stale installed copy.

## Review semantics before resolving text

For EVERY intentional difference in `FORK.md`, inspect the upstream diff/history
since the merge base and trace the affected behavior in the candidate. Check
renamed/moved ownership as well as the recorded paths: an upstream replacement
can bypass a custom hook without conflicting with it.

Classify what the new upstream code does:

- **Unrelated:** retain the behavior and run its regression check.
- **Refactored internals:** reconnect the personal policy through the new owning
  interface; remove obsolete glue. Keeping old internals alive creates a second
  implementation that every later merge must carry.
- **Both changes are compatible:** combine their behavior and test the interaction,
  rather than resolving the file with an entire side.
- **Overlapping features or changed product meaning:** compare creation defaults,
  explicit overrides, reverse transitions, persistence, permissions, remote
  behavior and supported clients. Similar names or screenshots do not establish
  behavioral equivalence.

If overlapping behavior would replace, remove or materially alter a recorded
customization, prepare the choices and recommendation for the weekly queue.
Do not silently retire custom code just because upstream now offers a feature
with the same name. During an interactive review, Ralf's answer can authorize
adoption; then use upstream's implementation, keep only necessary adaptations,
update the manifest and preserve the agreed regression checks.

## Verify the merged result

Use an ordinary merge of the pinned upstream commit so ancestry remains usable
for the next integration. Resolve mechanical conflicts autonomously; semantic
conflicts require the intent evidence above. Preserve upstream correctness and
security fixes, and expose any incompatibility with a personal behavior instead
of silently reverting the fix.

Run each customization's checks even when Git reported no conflicts. Add a
focused interaction regression when a newly discovered overlap warrants it;
keep assertions that protect intent. Check wire and migration changes against
the deployment procedure, not only local compilation. Verify both pinned
parents remain ancestors of the checked result, and publish normally only
after the explicit release procedure's gates pass.

When blocked, preserve the candidate and record its path, pinned refs, relevant
source evidence, choices, recommendation and check results in canonical
`.t3-fork/state/decisions.md`. Scheduled inspections never merge or publish;
an interactive session may ask its user directly. Mechanical failures such as
the old nested CLI's read-only Git metadata are repair work, not product
decisions. Work directly in the authorized T3 turn instead of recreating that
nested launcher.

Upstream integration normally runs inside an explicitly requested
[t3-fork-release](../t3-fork-release/SKILL.md) batch. A scheduled inspection only
fetches and reports updates; it cannot publish, stage or restart. A standalone
analysis or upstream preparation leaves its candidate unpublished unless Ralf
explicitly requests a release. Keep integration success distinct from deployment.
