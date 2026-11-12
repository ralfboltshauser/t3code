---
name: t3-fork-release
description: Release ready personal T3 features together with upstream updates, or resume/report their all-host deployment and safe cleanup. Use for merge and build, merge and publish, release everything ready, and release status.
---

# Release ready features

Read [the operations guide](../../../docs/operations/personal-fork.md). An explicit
release request authorizes normal publication, all-inventory staging and guarded
cleanup under the [release cleanup policy](references/cleanup.md). Feature completion alone does not authorize release.
Never create PRs or force-update `personal`/`main`. Missing hosts remain required.

Use canonical shared state (`manage.py paths`), not a worktree-local controller.
Keep this thread rooted; merges happen in the coordinator's candidate worktree.
Acquire `manage.py lock-run` in a persistent tty, hold stdin open through integration
and publication, and release by EOF. Read `manage.py status`, existing release JSON
and any deployment journal first. Run `workflow.py finalize` to finish eligible
cleanup from prior releases and report retained work. An incomplete cutover needs
recovery, not a new release. Use the coordinator from the latest canonical source; do not trust an old
worktree's skill or script over newer published instructions.

On EVERY release, run the cleanup policy's inventory and eligible old-release
cleanup before creating/building a candidate. Run it again after staging, before
ending the turn, to remove disposable build intermediates and record deployment
dependent deferrals. On status/resume after verified deployment, finish the
remaining cleanup. `workflow.py finalize` handles feature retirement only; it does
not clean builds, backups, browser caches or simulators. Perform those steps
explicitly on every inventory host and save the measured results in canonical
`state/cleanup/RELEASE_ID.md`. A release handoff must say which cleanup phase
finished and which items remain; staging alone does not complete cleanup.

## Freeze, integrate and check

```sh
python3 scripts/personal-fork/workflow.py list
python3 scripts/personal-fork/workflow.py freeze RELEASE_ID
python3 scripts/personal-fork/workflow.py integrate RELEASE_ID
```

Use a unique lowercase release ID. `list` fetches cross-machine ready markers,
checks exact branch heads and source activity, and reports exclusions. Unregistered,
dirty, active or stale features do not enter the batch. If a source is unreachable,
report its excluded features; never infer readiness from a branch name or chat title.
`freeze` pins personal, upstream and ready dependency order. New ready work waits
for the next release. Inspect exclusions and unresolved decisions before proceeding;
never silently choose product semantics or omit a requested dependency.

`integrate` creates/resumes a sibling candidate and ordinary merges. On conflict,
inspect the preserved candidate, resolve mechanical conflicts, commit and resume.
Follow [t3-fork-upstream](../t3-fork-upstream/SKILL.md) for EVERY `FORK.md` behavior,
including clean merges. Compare features with one another too. Queue ambiguous
product choices in canonical decisions.md and preserve the candidate.

Run the candidate's manifest checks and focused interaction tests, and perform
the required integrated client pass. Record their real commands/results in
`--checks`. The coordinator runs `check:changed` against the pinned personal
revision itself; use this one invocation so release checks cannot overlap:

```sh
python3 scripts/personal-fork/workflow.py verify RELEASE_ID --checks "Manifest, interaction and client commands/results"
python3 scripts/personal-fork/workflow.py publish RELEASE_ID
python3 scripts/personal-fork/workflow.py stage RELEASE_ID
python3 scripts/personal-fork/workflow.py report RELEASE_ID
```

Wait for `verify` to exit zero and record completed evidence before publishing.
Its printed log path or a passing individual step is progress, not completion.
On failure, inspect that log, fix and commit the candidate, then rerun `verify`.
It rejects source edits during checks, including edits restored to their old bytes.
Publish and stage revalidate the recorded inputs and completed process evidence;
legacy prose-only verification must be rerun.

`publish` rejects a changed candidate or a concurrent personal advance. Merge new
personal into the candidate, inspect interactions and reverify; never overwrite it.
`stage` builds the exact published commit on independent hosts concurrently and
queues only after every required artifact passes validation. An ancestor pending
revision
can be superseded under the release lock before cutover; divergent queues or any
cutover journal block it. Failed builds preserve the prior queue/installations.
Release the integration lock and end the turn after staging; the independent
worker owns shutdown, stopped-state backups, cutover and health checks.

## Resume, clean and report

For a status/resume request, read the existing release record and live status;
do not freeze another batch or repeat already successful checks without cause.
After ALL inventory hosts run the exact commit, run `workflow.py cleanup RELEASE_ID`
and `workflow.py report RELEASE_ID`, then complete the cleanup policy on every
host. It never deletes unrelated/unincluded branches,
advanced/dirty workspaces or a workspace still owned by T3. Runtime/process ownership
that cannot be proved safe defers deletion. Use T3's existing Storage cleanup to
retire chat-owned workspaces; do not write live SQLite or remove directories behind
resumable threads. Remote cleanup runs on the source machine after inspection.
Conditional ref deletion uses an expected SHA; this is not permission to rewrite
branch history. Preserve readiness/release records so included commits stay traceable.

Report user-visible features, upstream range/highlights, checks/limits, exact source
SHA, per-host staged/pending/verified state, removed branches/worktrees and every
retained item with its reason. Include before/after disk measurements, build and
backup retention, local/remote branch outcomes, worktree ownership deferrals,
and browser/emulator results. Link both the generated release report and the
cleanup record. A staged build
is not an installed release. Do not restart the host to finish your own task.
