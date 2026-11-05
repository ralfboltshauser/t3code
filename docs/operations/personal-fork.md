# Personal fork operations

This repository owns the product, local agent skills and maintenance tooling on
`personal`. `main` remains an upstream mirror. Keep the canonical checkout on
`personal`; use sibling worktrees for independent feature work. `FORK.md` is the
tracked record of personal behavior, connection points and verification commands.

## Installation-local configuration

Run `python3 scripts/personal-fork/manage.py paths` from any worktree. Git's common
directory identifies the canonical checkout, whose ignored `.t3-fork/` directory
holds shared configuration and state. Worktrees must not become separate release
controllers. A new clone requires explicit configuration before deployment.

Copy `scripts/personal-fork/hosts.example.json` and `settings.example.json` into
that directory as `hosts.json` and `settings.json`, and replace the placeholders.
Missing configuration blocks release operations; examples are not a usable cohort.

- `hosts.json` lists ALL required hosts, installation paths and persistent-data
  paths. An unreachable host remains required; removal needs Ralf's decision.
- `settings.json` contains signing identity, bundle ID and launchd label. Keep
  credentials in existing subscription, SSH and Keychain authentication systems.
- `state/` holds observed revisions, pending decisions, task/thread IDs, release
  manifests and recovery journals. Preserve it when relocating an installation.
  Accepted personal behavior belongs in tracked `FORK.md`, not this local queue.
- `builds/`, `staging/`, `tooling/`, `artifacts/`, logs and backups are generated
  or installation-local files. The whole `.t3-fork/` directory is ignored.

`python3 scripts/personal-fork/manage.py status` inspects live host state.
`./update-personal.sh` builds the current pushed `personal` revision on all hosts
and queues deployment. Host/configuration failures never narrow the cohort.

## Feature requests

Use `.agents/skills/t3-fork-feature/SKILL.md` for baseline selection, integration
seams, behavior verification and the `FORK.md` record. Normal feature requests
include verified publication to `personal` and staging for all inventory hosts,
following `t3-fork-release`. Respect explicit prototype, review-only or code-only
limits. PR creation is outside this workflow.

## Daily integration — 21:00 Europe/Zurich

Daily and weekly triggers are bound to a root maintenance thread. Unbound T3 tasks
currently default to a worktree of `main`, which lacks personal tooling; avoid
that default here. T3 must be running and the Mac awake. Fixed-time occurrences
more than ten minutes late are skipped, not caught up later.

1. Read canonical `.t3-fork/state/decisions.md`, any deployment journal, and live
   status. Recover an incomplete cutover before another release. Acquire
   `python3 scripts/personal-fork/manage.py lock-run` in a persistent tool terminal
   (`tty: true`); hold its stdin open and release by EOF. Defer if already locked.
2. Fetch `origin personal` and `origin main` explicitly. Configure/fetch upstream
   from the inventory URL. Pin personal and upstream SHAs. Advance origin's
   `main` only by a normal fast-forward push when it is an upstream ancestor.
3. Preserve blocked candidates and recorded unresolved product questions.
   Otherwise create a sibling candidate from pinned `origin/personal`. Work
   directly in this T3 turn: nested CLI agents previously failed with read-only
   Git metadata. Delegate only when Ralf asks.
4. Follow `.agents/skills/t3-fork-upstream/SKILL.md`. Read the candidate's current
   manifest, trace EVERY customization against upstream changes, and perform an
   ordinary merge of the pinned upstream SHA. Repair mechanical conflicts while
   preserving personal intent and upstream correctness/security fixes.
5. For semantic overlap or ambiguous behavior, record candidate path, pinned
   refs, source evidence, choices and recommendation in canonical
   `.t3-fork/state/decisions.md`. Retain the candidate and defer product questions
   to the weekly review. Routine infrastructure failures may be repaired directly.
6. Run applicable customization checks and `vp run check:changed` against the
   pinned personal base. On macOS, set `GIT_CONFIG_GLOBAL=/dev/null` and use a
   short `TMPDIR` on a case-sensitive scratch volume outside any repository:
   Linux fixtures need case-only filenames, executable fixtures must not inherit
   the repo's module type, and packaging probes reject ancestor `node_modules`.
   Allow a longer batch `--timeout` for large integrations; per-test limits stay
   unchanged. Follow source testing rules; CI owns repo-wide suites.
   Commit checked repairs/merge, verify both parents are ancestors and the tree
   is clean, then normally push to `personal`. Reconcile concurrent advances;
   force pushes are outside this workflow.
7. Even with no new upstream commits, compare the checked published personal
   revision to installed state. New personal features also need deployment.
   Run `python3 scripts/personal-fork/manage.py stage FULL_SHA` when needed.
   Finish the turn so the independent worker can observe the cohort idle.
8. Write refs, preservation review, check results and actual published/staged/
   pending/deployed state to `.t3-fork/state/last-run.md`. Daily runs do not open
   question threads/notifications or repeatedly redo the same blocked attempt.

## Weekly decisions — Sunday 21:00 Europe/Zurich

Read the queue, deployment journal, latest result and `state/weekly-review.json`
under canonical `.t3-fork/`. Reads need no integration lock. If no product or
recovery decision needs Ralf, finish quietly. Mechanical repair belongs to the
daily flow.

For unresolved decisions, reuse an unanswered review or open one foreground T3
thread in this project with root workspace, source evidence, choices,
recommendation and concise questions. Read the returned thread link before
using it. Open it with the configured personal app and show one macOS notification;
delivery depends on notification settings. Keep undecided behavior intact.
Only the weekly review writes `.t3-fork/state/weekly-review.json`; record its
link/date and decision identifiers there. Acquire the integration lock before
editing the shared decisions queue after Ralf answers. Send no external mail or
messages to other people; avoid duplicate interactive reviews.

## Deployment and recovery

`stage FULL_SHA` verifies publication on `personal`, builds immutable artifacts
for every host, and writes `state/pending.json` only after all pass. Install the
logged-in Mac's worker with `python3 scripts/personal-fork/install-worker.py`;
it invokes `deploy` every five minutes while the Mac is awake and logged in.

The worker validates the cohort fingerprint and staged artifacts; checks runs,
turns, effects, requests, imminent schedules and subprocesses; and requires two
idle observations at least a minute apart. Open terminal shells, resident
providers and unknown processes can postpone deployment. Do not terminate them
to clear the guard.

It journals BEFORE live changes, stops all hosts, rechecks persistent queues,
snapshots stopped databases, changes all installation pointers, then starts and
verifies the cohort. Known busy/unreachable hosts postpone the whole release.
There is no cross-host transaction or server admission lock: new work can arrive
between idle checks and shutdown. The stopped-state recheck prevents deploying
over such queued work but cannot undo interruption in that narrow race. Keep
new work out of the cutover window.

Partial cutovers stop retries and preserve the journal. Pointer-only failures
can restore/restart old binaries only before any new server starts. Incomplete
restoration keeps the cohort stopped. Once a new server starts, assume its data
may be migrated: old binaries may be incompatible. Inspect migration compatibility
and all hosts, finish forward or obtain Ralf's decision on a data-restoring
rollback. Preserve backups; clear the journal only after verified recovery.

The old Ubuntu `t3code-upstream-sync.timer` is disabled and superseded.
`scripts/personal-sync.sh` refuses its obsolete nested-agent flow. Preserve the
old remote candidate/report until the daily flow accounts for their work.
