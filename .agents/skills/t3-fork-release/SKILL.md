---
name: t3-fork-release
description: Publish checked personal T3 Code changes and stage the same source revision for every inventoried host, or inspect and recover a coordinated release without interrupting known active work.
---

# Deliver one revision to the host cohort

Read [the operations guide](../../../docs/operations/personal-fork.md) and the
canonical checkout's ignored `.t3-fork/hosts.json`; they own installation paths,
required hosts and recovery policy. Run `python3 scripts/personal-fork/manage.py paths`
from any worktree to locate shared state. Missing local configuration blocks
deployment; examples are not a usable host inventory. Read current scripts when
their behavior matters; a prior agent report is not live host evidence.

## Publish and stage

1. Inspect `python3 scripts/personal-fork/manage.py status` and any deployment journal.
   Resolve an incomplete cutover before queuing another release. Include every
   inventory host; an unreachable machine remains required.
2. For an authorized feature/integration delivery, verify the intended source
   commit is clean and has the required check results. Fetch `origin personal`
   and reconcile concurrent work without overwriting it. Normally push the
   checked result to `personal`; force pushes and PR creation are outside this
   workflow. The product's `main` remains an upstream mirror. Both product changes and maintenance tooling belong on `personal`.
3. Pin the full published SHA and run
   `python3 scripts/personal-fork/manage.py stage FULL_SHA`. This builds and verifies the
   whole cohort before queuing a cutover. Do not update just the machine on
   which implementation happened. If a build fails, report that result and keep
   the current installations; preserve failed artifacts for diagnosis.
4. Finish the T3 turn after staging. The independent launchd worker waits for
   the cohort to be idle; restarting the host from the agent would interrupt the
   very session preparing the release. Open terminals or resident subprocesses
   can conservatively defer deployment. Never terminate them to clear the guard.

Existing maintenance authorization covers the normal publication and staging
flow. An analysis, prototype or explicitly code-only request does not authorize
delivery. Keep source publication and live installation as distinct outcomes.

## Report or recover the actual state

Report the exact SHA and distinguish checked, published, staged, pending and
verified deployed. Claim deployment only after live status shows ALL required
hosts running that source revision and the cohort verification succeeded;
matching marketing version strings are insufficient.

The worker owns idle checks, staged artifacts, stopped-state backups, pointer
changes and health verification. Do not bypass it with direct app replacement,
service restarts, changes to the live SQLite database, or removal of an inventory
host. A failure journal stops retries because recovery depends on which steps
actually happened.

For recovery, inspect the recorded phase and each host before changing anything.
The worker can restore old binaries only before any new server has started.
After a new server starts, treat its database as potentially migrated: old
binaries may no longer be compatible. Follow the canonical recovery procedure,
keep all host states accounted for, and obtain Ralf's decision before restoring
data or changing accepted behavior. Preserve the journal until recovery is
verified; clearing it is not a repair.
