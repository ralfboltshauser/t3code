---
name: t3-fork-feature
description: Implement personal T3 Code features and fixes from this maintenance project, in isolated worktrees, preserve upstream mergeability, and leave checked feature branches ready for an explicit batched release.
---

# Implement a fork feature

Read [the operations guide](../../../docs/operations/personal-fork.md) for standing
delivery policy. This repository root owns both product code and maintenance
skills/scripts on `personal`; `main` remains an upstream mirror. Use
`python3 scripts/personal-fork/manage.py paths` to locate the canonical checkout
and its shared, ignored `.t3-fork/` state from any worktree.

## Attach and register the feature

Independent feature threads use a worktree from fetched `origin/personal`, never
the canonical checkout or `main`. Choose a stable lowercase feature ID before
editing and inspect this thread's workspace with `t3_worktree_status`. If rooted,
use `t3_worktree_handoff` with `branch: "personal-feature-ID"`, `baseRef: "personal"`,
`startFromOrigin: true` and a continuation prompt naming this skill and feature ID;
call it last, then
continue in the returned workspace next turn. Do not create another top-level
thread. For an explicitly stacked feature use the dependency's committed branch
and `startFromOrigin: false`.

A side chat shares the parent's feature, worktree and readiness. Do not register
or publish it separately. Coordinate edits with the parent and report completion;
the parent marks the combined feature ready only after all writers finish.

For an independent feature, choose a stable lowercase ID, then run from its worktree:

```sh
python3 scripts/personal-fork/workflow.py register FEATURE --summary "User-visible outcome" --thread THREAD_ID
```

Use `--depends FEATURE` for each prerequisite. Dependencies must be registered in
this clone when registering a stack; inspect remote ready records before adopting
cross-machine work. Never overwrite an existing registration. Existing worktrees
are not implicitly ready. The default UI is worktree/personal through `t3.json`;
agent-launched feature threads still need an explicit worktree workspaceStrategy.
Analysis and release threads may remain rooted.

## Establish the actual baseline

1. At the repository root, inspect status, remotes and history, then fetch `origin personal`
   explicitly. Pin its full SHA. An installed build or old checkout is not the
   current feature baseline. Preserve unfinished files, commits and worktrees;
   use the independent thread's worktree from that pinned baseline. Existing
   registered features stay in their workspace; do not replace a feature's
   unfinished work because personal advanced. Never stash someone else's work.
2. Read that candidate's `AGENTS.md`, `FORK.md` and
   `.agents/skills/t3-personal-fork/SKILL.md`. The latest manifest is authoritative
   for personal behavior; an older copy may claim there are no customizations.
3. Trace the requested behavior from its entry points to its owning service and
   state. Write down the observable acceptance criteria and affected surfaces.
   Inspect relevant upstream paths/history before selecting the integration
   point; fetch `upstream/main` when its state matters to this choice. If upstream
   already supplies the behavior, inspect how to reuse it before adding another
   implementation. Fetching upstream does not require merging its entire head
   into an unrelated feature branch.

## Choose a seam with low merge cost

Apply these choices to the actual owning code, in order:

- **An existing extension or policy boundary fits:** put the personal behavior
  behind it. Keep decisions in a domain function/service and transport handlers
  thin, so web, mobile, MCP and scheduled work share the implementation.
- **A small existing branch expresses the whole change:** edit that branch
  directly. A new abstraction or package for one condition creates more code
  to reconcile than the condition itself.
- **The behavior is substantial:** isolate the policy or component in a focused
  module near its owning domain, and connect it through a few explicit calls.
  Name it for its behavior, such as `sideChatPermissionPolicy`, rather than
  creating a catch-all `custom` module. Keep upstream-owned orchestration and
  lifecycle code recognizable.
- **Upstream structure cannot support the behavior:** make the necessary
  structural change and record the reason in `FORK.md`. Prefer a correct design
  over an artificial tiny diff; explain the recurring integration cost.

Use the current upstream interfaces and native contract/configuration mechanisms.
Avoid copying whole upstream modules, maintaining parallel versions of services,
runtime monkey patches, or text-replacement patches over built artifacts: those
hide conflicts rather than resolve the maintenance dependency. Add a setting or
feature flag only when the product needs a user choice or staged rollout.

Keep formatting, renames, dependency upgrades and generated-file churn outside
the feature unless required for it. Preserve lockfile resolution through the
repository's package manager. Small focused diffs leave Git more unchanged
context to merge; broad mechanical rewrites consume that context.

## Verify preservation, not just compilation

Follow the candidate's verification rules. Check backend/state behavior with
focused behavioral tests, including the transition that reverses or changes the
new behavior. For example, inheriting a parent's permission at creation should
still allow the child to change independently afterward. Assert that observable
contract rather than the name of a helper or its number of calls.

Walk the candidate's cross-surface checklist: entry points, web/desktop/mobile,
providers, MCP/scheduled paths, wire contracts and remote connections. State
which apply and verify them at the owning layer. For wire or persistence edits,
inspect how the old/new client and server meet during cutover and what migrations
do to rollback compatibility. Follow required integrated UI checks for visible
changes; do not start a server against live user data.

Run the required `check:changed` against the pinned personal baseline and the
candidate's customization checks. Inspect the final diff for incidental changes.
Record any unverified behavior instead of calling it tested.

Before delivery, review the fork delta from the merge base with `upstream/main`.
Account separately for upstream-owned production files and new fork-only tooling.
Inspect every production edit for avoidable churn; maintenance features should
not require changes to application internals. Explain any necessary core edit.

## Leave a maintainable feature and deliver it

Update the candidate's `FORK.md` intentional-differences section with:

- intended behavior and the reason it differs from upstream;
- owning modules and upstream connection points a future merge must inspect;
- a focused verification command and the essential behavioral assertions;
- any intentional removal or upstream behavior that must remain disabled.

Keep this as the single behavior manifest; do not create a second feature ledger
elsewhere. It is what detects semantic regressions after a clean merge.

Finish by committing only settled feature changes and running:

```sh
python3 scripts/personal-fork/workflow.py ready FEATURE --checks "Commands run and actual results"
```

This pushes the feature branch and an exact-commit readiness marker. It does not
publish to `personal`, build or install anything. Confirm no side chat or other
writer is still changing this workspace before marking ready; release also checks
persisted source activity. Report the feature ID, summary, checks, commit and
"ready for the next release". Honor prototype/code-only limits: do not mark them
ready without a finished implementation.

To resume or exclude a ready feature, run `workflow.py withdraw FEATURE` before
editing. Recheck and mark ready again when finished. A changed head invalidates
readiness automatically, but withdrawal also excludes same-head work in progress.
Only an explicit release request invokes
[t3-fork-release](../t3-fork-release/SKILL.md).
