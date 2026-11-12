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

## Feature development

Independent feature threads start in worktrees from fetched `personal`; side chats
share their parent's workspace and feature. `t3.json` sets worktree mode and the
base ref. Project settings may override the mode, so remove an old explicit Local
override in Project Defaults if new chats still start locally. Explicit branch
choices support stacked work. Agent-created threads use an explicit worktree
workspaceStrategy; release/inspection threads stay rooted.

Use `t3-fork-feature` for implementation. It registers a feature, verifies it and
pushes its feature branch plus an exact-commit `t3-ready/ID/SHA` annotated tag.
These tags make readiness discoverable across clones; they are operational
metadata, not a second behavior manifest. A source host must be in the release
inventory for its activity to be verified. Feature completion does not publish to
`personal` or stage a release. Side chats cannot mark the shared feature ready
independently. To resume a ready feature, withdraw readiness before editing.

From the feature worktree:

```sh
python3 scripts/personal-fork/workflow.py register FEATURE --summary "Outcome" --thread THREAD_ID
python3 scripts/personal-fork/workflow.py ready FEATURE --checks "Commands and actual results"
python3 scripts/personal-fork/workflow.py withdraw FEATURE
```

Register prerequisites with repeated `--depends FEATURE`. Explicit stacks must
contain the dependency's committed work. Preserve existing unknown worktrees;
register them only after inspecting their baseline, ownership and actual state.
Do not mark them ready merely because the agent's previous turn ended.

## Explicit releases

Ask `t3-fork-release` to release all ready features plus upstream. Hold
`manage.py lock-run` in a persistent tty through integration/publication. The
coordinator serializes state writes separately and stores resumable snapshots in
canonical `.t3-fork/state/releases/`. A snapshot freezes exact inputs, so newly
ready features wait for the next release. The candidate ordinary-merges features
in dependency order, then upstream. Review EVERY `FORK.md` behavior and interactions
between features; mechanical conflict repair is autonomous, product ambiguity is
recorded in `state/decisions.md`. Preserve blocked candidates.

```sh
python3 scripts/personal-fork/workflow.py list
python3 scripts/personal-fork/workflow.py freeze RELEASE_ID
python3 scripts/personal-fork/workflow.py integrate RELEASE_ID
# Review the candidate and run manifest/interaction/client checks.
# verify owns the one check:changed process against pinned personal.
python3 scripts/personal-fork/workflow.py verify RELEASE_ID --checks "Actual results"
python3 scripts/personal-fork/workflow.py publish RELEASE_ID
python3 scripts/personal-fork/workflow.py stage RELEASE_ID
python3 scripts/personal-fork/workflow.py report RELEASE_ID
```

Start with `workflow.py finalize` to finish cleanup of earlier installed releases;
a verified newer cohort containing that release also qualifies. Use a unique
lowercase release ID. `verify` runs
`vp run check:changed PERSONAL_SHA --fresh` in the candidate,
with a per-candidate verification lock, and records the completed exit status,
source/environment fingerprint and log digest. `--checks` records the separate
manifest, interaction and client checks. Wait for process exit zero; a log with a
passing step is not completion. A failed or interrupted attempt revokes earlier
verification. Publication and staging require the saved completed evidence and
unchanged inputs; older prose-only releases need verification before restaging.
The fresh flag bypasses only the aggregate passing-result cache; existing
compilation/task caches remain available. Publication rejects a changed candidate
or concurrent `personal` advance. Reconcile and reverify rather than force pushing.
Independent host builds run concurrently from the exact published result; all
builders settle before cohort validation and queuing. The normal release request covers
publication/staging and eligible cleanup, without a separate confirmation step.
Analysis and prototype requests do not authorize a release.

Finish the staging turn so the worker can deploy when all hosts are idle. On a
later release-status/finalize request, inspect live status, run
`workflow.py cleanup RELEASE_ID`, then `workflow.py report RELEASE_ID`. The report
lists included features, excluded work, checks, commit and cleanup outcomes. Add
upstream highlights and per-host live state to the human handoff.

Cleanup requires that every inventoried host runs the exact release. It protects
changed branches, dirty workspaces and T3 ownership. Chat-owned worktrees are
retired through T3's Storage cleanup; a Git script never removes a directory
behind a resumable chat. An orphan source may be removed only with no runtime or
workspace processes. Unknown activity defers removal. Source cleanup runs on its
owning machine, with exact-head checks and compare-and-delete refs. Conditional
deletes may use a SHA lease; rewriting `personal` or `main` remains prohibited.
Retained work is reported with the reason, not called cleaned. Feature-worktree
cleanup does not prune build caches or backups. Every release also follows the
[release cleanup policy](../../.agents/skills/t3-fork-release/references/cleanup.md):
inventory all hosts and clean eligible older artifacts before building, remove
disposable intermediates after staging, and finish retirement after verified
deployment. Protect installed, queued and recovery revisions plus the previous
successful cohort; keep backups for 30 days and at least three successful
deployments. Audit local/remote branches, worktrees, isolated test state, browser
revisions and mobile infrastructure against actual ownership and consumers.
Record before/after sizes, removals and explicit deferrals in canonical
`state/cleanup/RELEASE_ID.md` and link it in the release handoff. These additional
steps are required agent work; the idle deployment worker does not run them.

`./update-personal.sh` remains a low-level way to stage already-published personal
with completed release verification evidence; it does not gather features or merge
upstream. Prefer the release skill.

## Daily upstream inspection — 21:00 Europe/Zurich

The daily task only fetches `origin personal` and `upstream main`, records exact
refs and a concise summary in canonical `state/last-inspection.md`, and preserves
all feature/release state. It does not merge, commit, push, build, stage, clean up
or restart hosts. Acquire the integration lock for the shared report write. No
daily notifications or new review threads. The weekly decision review remains.

Schedules are bound to the root maintenance thread. T3 must be running and the
Mac awake; fixed-time occurrences more than ten minutes late are skipped.

## Weekly decisions — Sunday 21:00 Europe/Zurich

Read the queue, deployment journal, latest result and `state/weekly-review.json`
under canonical `.t3-fork/`. Reads need no integration lock. If no product or
recovery decision needs Ralf, finish quietly. Mechanical repair belongs to an interactive maintenance turn.

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
for every host, and writes `state/pending.json` only after all pass. A queued
ancestor revision may be superseded under the release lock before cutover; its
record is archived and idle observations reset. Divergent queues or a cutover
journal block replacement. Failed builds leave the existing queue intact.
Mac bundles are signed and
strictly verified at a temporary path before atomic publication, so interruption
cannot expose an unsigned bundle as ready. Install the
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
