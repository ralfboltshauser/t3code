# Release cleanup policy

Run this procedure before release builds, after staging, and on the first
status/resume after verified deployment. The staging turn must end so the idle
worker can deploy; record post-deployment work as pending and finish it on resume
or the next release's preflight. This is an agent procedure, not an automatic
worker hook. Existing `workflow.py cleanup/finalize` covers only included feature
workspaces and refs. Do the additional infrastructure cleanup explicitly.

## Inventory and protect

1. Resolve canonical paths with `manage.py paths`. Read `manage.py status`, host
   inventory, pending/deployment/last-deployment records, release manifests and
   feature registrations. Hold the existing integration lock for shared records
   and the release lock for artifact deletion; do not overlap a builder, cutover
   or another cleanup. Defer mutation when a deployment journal needs recovery.
2. On each inventory host, measure filesystem free space and allocated sizes of
   release builds, staging/releases, artifacts, backups, worktrees, test state,
   browser caches, and emulator/simulator data. Derive paths from configuration
   and the owning tools. Use `du`, not apparent sparse-file sizes; APFS clones and
   shared dependencies mean directory totals are not guaranteed reclaimable bytes.
   Inspect large children rather than labelling an entire T3 home disposable:
   `projects/` can contain original user files, photos and repositories.
3. Build an explicit keep set from every host's installed revision, the pending
   revision, active candidates/builds, unresolved releases and recovery journals.
   Keep the immediately preceding successfully deployed cohort's artifacts as
   well. Determine chronology from deployment evidence, not directory mtimes.
   Retaining an old binary does not establish that its database can be rolled back.
4. Record exact candidate paths/refs, sizes, owning release/project, protection
   evidence and the proposed action in canonical `state/cleanup/RELEASE_ID.md`.
   Inspect process ownership and recheck references immediately before deletion.
   Unknown ownership, unreachable hosts or missing evidence mean retain with a
   concrete reason. Continue independent safe cleanup on reachable hosts; never
   silently shrink the release inventory or terminate processes to enable cleanup.

Normal release authorization covers proven obsolete generated artifacts and
merged, retired release/feature refs under this policy. Preserve original project
files, live T3 userdata/auth/settings, user browser profiles and emulator app data.
Do not run broad home-directory deletion, `git clean -xfd`, reset active checkouts,
expire reflogs or use `git gc --prune=now` as cleanup shortcuts.

## Repository and worktrees

- Fetch branch refs with pruning on the owning clone. Inventory local branches,
  remote heads and `git worktree list --porcelain`, including old integration
  candidates and branches not included in the current release. Remote-tracking
  pruning does not delete real remote branches.
- Run `workflow.py finalize`, then `cleanup RELEASE_ID` for an installed release.
  A uniformly running verified descendant also qualifies under the coordinator's
  ancestry guard. Preserve its release/readiness records and archival release
  refs: they are small and establish which commits shipped.
- For older/unregistered branches, establish their owner and exact local/remote
  heads, prove inclusion in the verified deployed personal history, and verify
  there is no pending feature/dependency, active or resumable chat, dirty/untracked
  work, or other worktree using the branch. Being merged or old alone is not
  permission to delete a chat workspace. Unknown branches remain reported.
- Retire chat-owned worktrees using T3's supported Storage cleanup after checking
  its preview and eligibility. Preserve resumable chats; do not edit live SQLite
  or remove their directories manually. Orphan worktrees use the existing
  `host.py` workspace probe/cleanup guards on their owning host; respect a refusal,
  including its source-runtime/process guard. Never bypass it with `rm -rf`.
- Delete only refs still at the inspected, merged SHA, after workspace retirement:
  local compare-and-delete via `git update-ref -d REF EXPECTED_SHA`, remote
  deletion via an exact-SHA `--force-with-lease=REF:EXPECTED_SHA`. Preserve `personal`,
  `main`, default/protected branches, upstream refs and advanced heads. Inspect
  `git worktree prune --dry-run` before pruning stale administrative entries;
  temporarily unavailable/mounted worktrees are not proven gone.

## Builds, release copies and local test state

- Outside the keep set, remove known release-owned build clones, staged bundles,
  extracted Linux releases and duplicate archives on their owning host. Check
  actual installation pointers, process executables/cwds and build ownership as
  well as manifests. Dirty clones and partial/failed builds with an unresolved
  investigation remain retained. Never delete an installed or queued artifact.
- Once staging succeeds, its build checkout and duplicate unsigned packaging
  output may be removed even for the queued SHA if every required immutable
  artifact has validated and neither runtime nor builder uses those intermediates.
  Preserve signed/ready output, verification evidence and any referenced logs.
  Active development worktrees keep their dependencies; do not purge shared
  package stores or native toolchains needed by other projects.
- Keep all stopped-state database backups from the last 30 days AND the newest
  three successful deployments, plus every backup referenced by pending recovery.
  Delete only older maintenance-generated snapshots outside that union. Preserve
  manifests, readiness records, verification receipts and their referenced logs;
  remove only unreferenced temporary logs/test captures older than 30 days.
- Remove isolated dev databases, scenario fixtures, sparse test images and build
  scratch only after proving the owning run has ended and no thread/recovery
  record needs them. Never treat user projects or all `.t3` directories as caches.

## Browser automation and mobile infrastructure

Audit these on every release; removal depends on shared consumers, not T3's
lockfile alone. Read the installed tools' help and local package metadata before
choosing their supported cleanup commands; avoid downloading tools just to clean.

- For Playwright/Puppeteer, inspect cache registrations (including Playwright's
  `.links`), installed package browser manifests and active browser executables.
  Keep revisions required by active worktrees, other registered projects, global
  automation tools and this release's verification. Remove only unreferenced,
  unused revisions through the tool's scoped cache cleanup or individually
  inspected cache paths. Never use uninstall-all or retain only the highest
  version: different packages pin different revisions. Broken registrations
  require owner inspection before they can be discarded.
- Inventory Apple runtimes/devices with `xcrun simctl list ... -j`, Android AVDs,
  SDK system images and connected/running emulators with their installed tools.
  Identify what current mobile verification and other active projects need.
  Retain those runtimes/images/devices and all booted or attached devices.
- Remove disposable, retired devices only when their data is confirmed expendable.
  An unavailable Apple device or old Android API level can still contain useful
  app data or a compatibility fixture. Remove an unused runtime/system image only
  after accounting for every dependent device and project; use simctl/Xcode or
  avdmanager/sdkmanager, never delete their managed storage directories wholesale.
  If data ownership or test coverage is uncertain, retain it with the specific
  unresolved dependency. Do not install replacements as part of cleanup.

## Verify and close the phase

Recheck protected installation/queue pointers and artifact readiness, local/remote
heads and remaining worktrees after mutations. Measure free space and the same
directory sizes again. Record commands/outcomes, actual reclaimed space, removals,
retained items with reasons, unreachable hosts and the next eligible phase in
`state/cleanup/RELEASE_ID.md`. Reuse this record on resume without repeating already
successful work. Link it beside `workflow.py report RELEASE_ID`; do not overwrite
the generated report with a second release narrative.

Call cleanup complete only when every inventory host/category was inspected and
each candidate was either removed or explicitly retained under the policy. Mark
unreachable/uninspected hosts or deployment-dependent retirement as deferred.
