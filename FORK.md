# Ralf's T3 Code

The root of this repository is the product fork. Integrate personal features and
maintain its skills/tooling on `personal`; develop independent features in worktrees. `main` follows `pingdotgg/t3code:main`
without personal commits; connect upstream history through ordinary merges.

Fetch `origin personal` and inspect status/history before starting work. Preserve
unfinished files and local commits; use a sibling worktree from the latest
`origin/personal` for independent work. Keep the canonical checkout on `personal`
so the maintenance worker's scripts remain available. Read upstream files with
Git or a worktree instead of switching the canonical checkout to `main`.

Use `.agents/skills/t3-fork-feature/SKILL.md` for feature work and
`.agents/skills/t3-fork-upstream/SKILL.md` for upstream integration.

New product feature questions, plans and implementation requests first use
`.agents/skills/t3-explore/SKILL.md` for current upstream GitHub, public team/X
and community research. `AGENTS.md` and `t3-fork-feature` route to it so overlap,
maintainer intent and uncertainty inform whether to reuse, wait, adapt or build.
Routine bug fixes, releases and fork-tooling maintenance are outside this step.
Validate changes with skill-creator's `quick_validate.py` and `vp run check:changed`.

Feature work follows `t3-fork-feature` and ends ready on a pushed feature branch.
Only an explicit `t3-fork-release` / "merge and build" request gathers ready
features plus upstream and stages a release. Side chats share their parent's
feature. Daily maintenance inspects upstream without publishing.

## Intentional differences

Personal builds do not collect or send T3 product analytics, identify provider
accounts for analytics, export relay traces or remote OpenTelemetry diagnostics,
send agent feedback, or publish agent activity for cloud notifications.
The server uses disabled analytics, relay-tracing and activity layers and clears
remote collector destinations at launch. Feedback is effectively Off even when
an older settings file enables it. Keep local tracing, usage accounting and
provider authentication. Keep direct, linked and T3 Connect connections as
transport choices. T3 Connect and model providers still receive the requests
necessary to provide their services.

Preserve the disabled production layers in `apps/server/src/server.ts`,
`cli/connect.ts`, `apps/web/src/lib/runtime.ts`, and mobile
`features/observability/tracing.ts`. Do not restore identity reads in server
startup or Codex sign-in, or analytics WebSocket parameters and device storage
in `packages/client-runtime` and the platform adapters. The desktop main process
uses `DesktopObservability.layerLocalOnly`. Mobile removes Expo Observe and
disables upstream over-the-air JS updates so the official feed cannot reintroduce
tracking. Keep the Clerk SDK telemetry opt-out on all three client surfaces and
the native iOS and Android opt-out in the Clerk Expo native components patch.

Check that configured analytics and trace endpoints receive no requests, that
pairing and DPoP ticket URLs carry no analytics metadata, and that native builds
neither include Observe nor take upstream OTA updates. Inspect the Diagnostics
screen in a rebuilt native client and confirm local diagnostics remain available
where supported.

```sh
vp test run apps/server/src/telemetry/AnalyticsService.test.ts apps/server/src/cloud/CloudLink.test.ts apps/server/src/observability/OtlpEndpointCheck.test.ts apps/desktop/src/app/DesktopObservability.test.ts apps/web/src/lib/runtime.test.ts packages/client-runtime/src/authorization/remote.test.ts packages/client-runtime/src/connection/resolver.test.ts apps/mobile/src/features/observability/tracing.test.ts apps/mobile/app.config.test.ts apps/mobile/src/features/cloud/CloudAuthProvider.test.ts
```

The web and desktop Thread details card shows **Agent tasks** whenever the thread
has a nonempty provider checklist. The section opens expanded, can be collapsed,
and stays collapsed through live updates. When it displays a checklist from an
earlier run, its title reads **Last checklist**. Keep the list scrollable so
expanding it does not push the workspace controls out of the compact layout.

Reuse the existing thread projection in `ChatView.tsx`, `session-logic.ts` and
`chat/ThreadDetails{Panel,Card,Tasks}.tsx`. Reconcile with upstream PR #29705 while
preserving automatic visibility and default expansion. Verify ordering and empty-list
replacement, disclosure and counts, and run a real web client with Replay's
`todo-list` scenario to verify the checklist reaches the card.

```sh
vp test run apps/web/src/session-logic.test.ts apps/web/src/components/chat/ThreadDetailsPanel.browser.test.tsx
vp run i18n:check
```

Idle independent chats can move to a linked machine through `/move`, the web chat
menu or palette, and the native move screen. Move recent portable text and captured
Git work into an operation-owned destination worktree, with optional continuation;
blank moves never start a provider turn. Keep the source fenced during uncertainty,
replay the original import/continuation receipt, retain exceptional source files, and use a fresh
operation for return moves. No active/deferred self-handoff or implicit process,
attachment, credential, goal, schedule or watch migration. Workflow-owned threads
stay on the environment hosting the workflow run. Both servers advertise
`threadHandoffProtocol: 1`; old clients remain subject to server fencing. Do not run
an older server against threads with pending or completed moves: it lacks that fence.

Owning modules are `peer/handoff/{ThreadHandoff,HandoffImport,HandoffGit}.ts` and
`orchestration-v2/ThreadImportService.ts`. Upstream merges must preserve native
imported history in `thread.create`, the normal `ThreadLaunchService` setup path,
workspace admission/queued-start fences in `Orchestrator.ts`, projection metadata,
guarded RPCs, peer forwarding, and web/native entry points. Reconcile with upstream’s
import/Git/handoff stack rather than retaining duplicate implementations when it lands.

```sh
vp test run apps/server/src/peer/handoff apps/server/src/orchestration-v2/ThreadImportService.test.ts apps/server/src/orchestration-v2/ProjectionRecovery.test.ts apps/server/src/persistence/Migrations.test.ts apps/server/src/persistence/reconcileV2PreviewMigration.test.ts apps/server/src/orchestration-v2/ThreadManagementService.test.ts apps/server/src/orchestration-v2/ProviderTurnControlService.test.ts apps/server/src/peer/PeerForwarding.test.ts apps/server/src/peer/PeerLinkRequests.test.ts apps/server/src/peer/RemoteDelegation.test.ts apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts apps/server/src/mcp/linkOrigin.test.ts apps/server/src/mcp/toolkits/core.test.ts apps/server/src/provider/AgentContextBudget.test.ts apps/server/src/process/externalLauncher.test.ts apps/server/src/ws.test.ts packages/client-runtime/src/state/commandPermissions.test.ts apps/web/src/hooks/useThreadActionMenu.test.ts
```

These checks cover source staging preservation, Git failure cleanup, immutable
retry identity, lost replies and changed link grants, original continuation receipts,
blank imports, and the server’s move fence. Real peer verification uses isolated
databases/clones; never experiment with a live chat’s ownership.

New moves pin the exact incoming Git snapshot before setup/continuation and retain
it as visible recovery history until explicitly discarded. Compact authenticated
receipts replay the original run independently of workspace, upload, project and
provider availability; accepted source requests/bundles and received uploads are
reclaimed after durable acknowledgement. Protocol 1 transfer remains compatible;
only a versioned incoming-snapshot receipt permits retirement.

Accepted moves immediately wake StorageCleanup even with age policies disabled.
Only newly allocated operation-owned move worktrees qualify, under exclusive T3
use with external writers stopped. Root/admin inode provenance, all-project owner
and writer/effect checks, unchanged H/index and exact raw snapshot bytes gate
force removal. Compare-delete only a proven owned unused branch at captured H.
Keep legacy/project/shared/subdirectory sources and staged, ignored, filtered,
sparse or unsupported local state; never replace these protections with age rules
or blanket dependency-directory deletion. Retain unknown worktree administration
files and reflog-only history unless shared refs or the outgoing snapshot retain it.
Only exclusive disposable move paths retain a workspace fence after acceptance;
other chats must remain able to use protected project roots and shared checkouts.
Incoming snapshots are distinct from post-setup checkpoints, retained through onward moves/deletion, and capped at 256
per repository without TTL eviction. Tiny receipts and unique history can grow;
automatic cleanup does not promise backups or safety against external writers.

Preserve the narrow ownership/capture helpers in `peer/handoff/MoveWorkspace.ts`,
`moveRetirementCapture.ts` and `retireMoveWorkspace.ts`, the existing cleanup worker
wake, global workspace admission fencing across project aliases, indexed fence
lookup (migration 82), imported setup completion observation in ThreadLaunchService,
and web/mobile kept/removed status plus incoming recovery command. Do not resurrect
retired paths on import replay or destructively adopt legacy moves by name.
`moveWorkspaceMetadata.ts` preserves the shared macOS creation-provenance bytes in
the local ownership record and rejects changed/custom attributes, ACLs, ownership,
flags or permissions. Attribute inspection requires Python 3; unavailable inspection
keeps the source. `workspace/workspaceAdmissionPath.ts` resolves missing paths through
existing ancestors, preserving ordinary checkout recreation while rejecting dangling
aliases. MCP thread reads expose the same move status and incoming recovery identity.

```sh
vp test run apps/server/src/peer/handoff apps/server/src/orchestration-v2/ThreadImportService.test.ts apps/server/src/orchestration-v2/ThreadLaunchService.test.ts apps/server/src/storageCleanup.test.ts apps/server/src/workspace/workspaceAdmissionPath.test.ts apps/server/src/mcp/OrchestratorMcpService.activity.test.ts packages/client-runtime/src/state/threadHandoff.test.ts packages/client-runtime/src/state/commandPermissions.test.ts
```

These cover pre-setup snapshot recovery/GC, quota refusal without eviction,
receipt-first blank/continuation replay, cross-project admission, supported raw
capture versus staging/ignored/filter/index exceptions, replacement/late-edit
safety, reflog/admin-file retention, owned branch removal, restart reconciliation and immediate cleanup with
age rules off. A primary real-client pass must also prove repeated back-and-forth
isolated moves with Replay, cleanup status/recovery controls and bounded disposable
checkouts/branches/transport payloads, counting retained history separately.

New independent threads default to worktrees based on fetched `personal` through
`t3.json`'s `defaultThreadEnvMode` and `defaultWorktreeBaseRef`. Explicit dependency
branches and side-chat workspace inheritance remain available. Preserve base
selection in web `useHandleNewThread.ts` and mobile
`new-task-context-presentation.ts`, including native pending-draft presentation.
Feature readiness, frozen dependency-ordered release inputs and cleanup guards
live in `scripts/personal-fork/workflow.py`; all-host build/cutover stays in
`manage.py`. Shared readiness tags allow cross-clone discovery. Never restore
per-feature automatic publication or scheduled daily releases.
Verify with:

```sh
python3 -m unittest discover -s scripts/personal-fork -p 'test_*.py'
vp test run packages/shared/src/t3ProjectFile.test.ts apps/web/src/hooks/useHandleNewThread.test.ts apps/mobile/src/features/threads/new-task-context-presentation.test.ts apps/mobile/src/state/pending-new-tasks-model.test.ts apps/mobile/src/features/threads/new-task-flow-provider.test.tsx apps/mobile/src/features/threads/NewTaskDraftRouteScreen.test.tsx
```

Embedded side chats share their host panel's F6 stop and per-tab focus history.
Their conversation and composer remain labelled regions, without registering
duplicate workspace areas. This lets the existing panel focus rules select the
input on first open and restore the last used control when returning, while
preserving scroll position when an old message control has left view. Preserve
the `embedded` handling in `apps/web/src/components/ChatView.tsx` and the region
props in `apps/web/src/lib/workspaceFocus.ts` when upstream changes panel focus.
Verify opening/reopening, bidirectional F6 navigation and isolated focus history with
`vp test run apps/web/src/lib/workspaceFocus.browser.test.ts`.

Side chats inherit their parent's permission mode when created, including their
first turn, so starting a side conversation preserves the access already chosen
for that work. The side chat's mode can then be changed independently. Keep this
behavior in `ThreadForkService.ts`, `ProviderTurnStartService.ts`, and the web
`useSideChat.ts` hook; do not restore the upstream supervised overrides.

Verify with:

```sh
vp test run apps/server/src/orchestration-v2/ThreadFork.execution.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts -t 'side chat'
```

Sidebar profiles are an opt-in Labs feature that scopes the boring sidebar by
physical `(environmentId, projectId)` membership before repository grouping.
Project assignments override environment defaults, with a permanent General
fallback. Keep client-local profile persistence separate from ordinary settings
snapshots: desktop uses `DesktopSidebarProfiles` and IPC, web uses transactional
IndexedDB, and mobile uses serialized preference transforms. Switching retains
drafts and running work; disabling retains assignments. Preserve filtering in
sidebar groups, search, new-thread defaults, and native project selection, and
preserve profile intent across asynchronous project creation and pairing.
Both index drafts and server-welcome bootstrap navigation wait for profile and
client settings hydration. Profiles suppress bootstrap navigation, so reload
cannot replace a saved context.
Configurable `profile.next` and `profile.previous` shortcuts reuse profile
navigation and wrap in saved order, including All profiles after the last profile. Keep them available in
Keybindings settings without assigning default keys; they are inactive in dialogs
and settings and when profiles are disabled.
Keep `SidebarProfileNavigation.tsx` handlers and the desktop Browser forwarding
list in `ReopenClosedViewShortcut.tsx` connected to the same profile actions.

Owning modules are `packages/client-runtime/src/sidebarProfiles.ts`, web
`sidebarProfiles.ts` and `SidebarProfiles.tsx`, desktop
`settings/DesktopSidebarProfiles.ts`, and mobile `state/sidebar-profiles.ts`.
Verify precedence, reversible moves, concurrent durable writes, and UI scoping:

```sh
vp test run packages/client-runtime/src/sidebarProfiles.test.ts apps/desktop/src/settings/DesktopSidebarProfiles.test.ts apps/web/src/sidebarProfilesStorage.browser.test.ts apps/web/src/components/SidebarProfiles.browser.test.tsx apps/mobile/src/state/sidebar-profiles.test.tsx apps/web/src/components/SidebarProfiles.startup.browser.test.tsx apps/desktop/src/app/DesktopApp.test.ts apps/mobile/src/features/projects/AddProjectScreen.test.ts apps/mobile/src/features/connection/ConnectionsNewRouteScreen.test.tsx apps/mobile/src/features/settings/SettingsServerControlsRouteScreen.test.tsx
```

The boring sidebar reuses the Working-section setting to fold independent work
inside each project, rather than disabling Working. Keep the existing inbox
classification and return ordering, selected-thread visibility, and project
status summaries. Read/idle unsettled chats also fold into a separate Read group,
while unread results, failures, actionable plans, requests, and unseen snooze wakes
stay visible. Read folding is independent of the Working setting; opening either
group never settles its threads. Expansion is client-local per profile and repository group;
profile membership is still applied before grouping. Preserve V2's global shelf,
pinned/snoozed/settled placement, and mobile's existing layout. Owning paths are
`Sidebar.tsx`, `Sidebar.logic.ts`, `sidebar/SidebarProjectWorkingHeader.tsx`, and
`lib/sidebarTree.ts` (nested focus recovery). Verify folding, current-thread
visibility, read/unread transitions, actionable returns, and keyboard fallback with:

```sh
vp test run apps/web/src/components/Sidebar.logic.test.ts apps/web/src/components/Sidebar.browser.test.tsx apps/web/src/lib/sidebarTree.browser.test.ts
```

Last user message project ordering puts projects with non-archived, unsettled
threads first, ranked by those threads' latest user message. Empty and settled-only
projects follow, ordered by the existing project updated/created timestamp fallback.
Reopening a chat restores its message timestamp and priority. Keep this policy in web
`Sidebar.logic.ts` project sorting, shared by the boring sidebar, project pickers
and command palette. Preserve manual and Created at ordering, profile scoping,
repository grouping and hidden-subagent exclusion; native mobile is unchanged.
Verify empty and settled-only projects, mixed settled/unsettled threads and the
settle/reopen transition with:

```sh
vp test run apps/web/src/components/Sidebar.logic.test.ts
```

An empty chat composer sends the latest queued human message with Mod+Enter,
using the existing Send now command and eligibility rules. Pending optimistic
messages wait for their exact server acknowledgement; navigation, removal, or a
changed active turn cancels that pending shortcut. Preserve the editor-local
routing in `composer-logic.ts`, `chat/composerCommandKey.ts`, `ChatComposer.tsx`
and `ChatView.tsx`, and the selection/acknowledgement handling in
`chat/QueuedRunsControl.tsx`. Keep nonempty submissions and the existing
Mod+Shift+Enter first-queued-message shortcut unchanged. Holding Mod in an empty
composer with queued messages shows the send arrow in place of Stop; releasing
it restores Stop. Preserve this feedback in `ComposerPrimaryActions.tsx` and its
callback wiring through `ComposerFooterControls.tsx`. Web, desktop, and
embedded side chats share this path; native mobile keeps its existing controls.
Verify with:

```sh
vp test run apps/web/src/composer-logic.test.ts apps/web/src/components/chat/QueuedRunsControl.browser.test.tsx apps/web/src/components/chat/ComposerPrimaryActions.browser.test.tsx
```

Project headers in the boring sidebar show a thin composition ring and the total
of their section's chats whether expanded or collapsed, including folded Working
members and the current chat. Preserve the exclusive status counts (attention,
failure, unread completion, working, then read/idle), server-first visit watermarks,
and exact accessible/tooltip breakdown. Rounded segments start clockwise from the
top with small gaps; tiny shares retain their extent without overlapping caps.
Keep the summary visible when the new-chat action replaces the chevron on hover.
Owning paths are `Sidebar.logic.ts`, `Sidebar.tsx`,
`sidebar/SidebarProjectFolderHeader.tsx`, and `sidebar/SidebarProjectStatus.tsx`.
Verify transitions, exclusive counts, and stable totals through project folding:

```sh
cd apps/web && vp test run src/components/Sidebar.logic.test.ts src/components/Sidebar.browser.test.tsx
```

Chats waiting on the user use the warning palette for input, approval, and guest
requests, matching the project ring's attention segment. Preserve semantic warning
tokens in web `Sidebar.logic.ts` and `sidebar/SidebarThreadRow.tsx`, mobile
`thread-list-v2-items.tsx` and `ThreadSideChatsRow.tsx`, and the shared approval/input
tint in `widgets/AgentActivity.tsx`. Guest identity colors remain separate from
pending request status. Verify with `vp run check:changed` and light/dark client
captures of an input request beside its project summary; this is a visual change.

Project-folder chevrons use stable environment-ID accents for secondary hosts;
primary and known desktop-local environments stay neutral, while multi-environment
folders use a distinct shared accent. The existing project tooltip replaces its
chat-count heading with matching machine icons and environment names, retaining
status rows, accessible totals, row dimensions and New chat hover behavior.
Keep this presentation in web sidebar `sidebarProjectHosts.ts`,
`SidebarProjectFolderHeader.tsx` and the optional heading in
`SidebarProjectStatus.tsx`, wired through `Sidebar.tsx`. Reuse existing catalog
identities, desktop-local classification and machine icons; do not add persisted
color assignments or infer locality from URLs. Native mobile is unchanged.
Verify identity deduplication, stable accents, local neutrality and hover/focus
without changing New chat behavior:

```sh
vp test run apps/web/src/components/sidebar/sidebarProjectHosts.test.ts apps/web/src/components/Sidebar.browser.test.tsx
```

The fork also maintains project-local skills and coordinated deployment tooling
under `scripts/personal-fork/`. Release verification runs one candidate check
process and binds its completed exit status and log to unchanged source and
relevant environment inputs. Preserve this evidence gate in `verification.py`,
`workflow.py` and `manage.py`; narrative verification alone cannot publish or
stage. Changed-check tests stream output so interrupted runs retain partial
diagnostics. Independent host builds overlap, while every required host must validate
before queuing. Mac bundles become visible only after signing and strict
verification at a temporary path. Shared `testing/longTempDir.ts` canonicalizes
Darwin temp aliases without removing explicit symlink test coverage.
Verify failed/interrupted/stale checks, mixed-source rejection, concurrent build
failure preservation and failed-signing invisibility with:

```sh
python3 -m unittest discover -s scripts/personal-fork -p 'test_*.py'
vp test run scripts/check-changed.test.ts packages/shared/src/testing/longTempDir.test.ts
```

Every release also requires the release skill's
`.agents/skills/t3-fork-release/references/cleanup.md` procedure before builds,
after staging and after verified deployment. It covers all-host artifact and
backup retention, local/remote refs, worktree ownership, browser revisions and
mobile infrastructure. Keep installed/queued/recovery revisions and active user
work protected; report measured removals and deferrals in canonical local state.
This is an agent procedure; feature cleanup and the idle worker alone do not
perform infrastructure retention. Validate skill changes with the skill-creator
`quick_validate.py` and `vp run check:changed`.

`thread.toggleUnread` is an unbound command in Keybindings settings that toggles
the active persisted chat between read and unread using its latest completed
result and server-first visit watermark. Marking read visits that completion;
marking unread reuses the existing action. Chats without a completed result,
drafts and held-key repeats do not dispatch. Keep the handler in
`chat/useThreadLifecycle.tsx`, its contract registry entry and the Settings
label in `KeybindingsSettings.logic.ts`. Preserve the independent Mark Unread
command. Verify both directions without navigation, Read-group placement and
project counts in an isolated client, plus
`vp test run packages/contracts/src/keybindings.test.ts packages/client-runtime/src/state/threadVisits.test.ts apps/web/src/components/Sidebar.logic.test.ts`.

`thread.markUnread` is an unbound command in Keybindings settings that marks the
open persisted chat unread without navigating away. It reuses `useThreadActions`
and existing visit semantics; drafts and held-key repeats do not dispatch it.
Preserve the command registration in `packages/contracts/src/keybindings.ts` and
the handler in web `chat/useThreadLifecycle.tsx`. Web and desktop share this path;
embedded side chats and native mobile retain their existing shortcut scopes.
Verify configuration decoding and unread visit preservation with
`vp test run packages/contracts/src/keybindings.test.ts packages/client-runtime/src/state/threadVisits.test.ts`,
then assign, reload, invoke and remove a custom binding in an isolated client.

Record each customization here with its intended behavior, owning paths, and a
focused verification command. Record intentional removals too, so an update
cannot silently restore them.

Sidebar Backlog parks unfinished work until explicit restoration, without timed
snooze's early wakes for requests, failures or messages. Web/desktop Snooze menus
(including bulk selection) offer Indefinitely (Backlog), with a separate collapsible
shelf, active-route visibility, keyboard parent recovery, Undo and drag-out restore.
Native mobile uses its existing Snoozed shelf with Backlog labels and restore
controls. MCP `t3_thread_organize` accepts `backlog`, reversed by `unsnooze`.
Providers share this policy; parking leaves existing background work running.

The reserved `BACKLOG_SNOOZED_UNTIL` timestamp in contracts reuses the persisted
snooze field and existing guarded commands, projections, remote forwarding and
handoff snapshots. There is no schema migration. Preserve the special case in
server `Orchestrator.ts` message/request/recovery transitions and
`ThreadSettlementService.ts`, shared `threadSettled.ts`/`threadCommands.ts`, web
Sidebar partition/markers, menus, lifecycle/usage-limit banners and Undo notices,
and native thread-list/detail/recovery presentation. Do not restore automatic
wakes or auto-settlement for parked work. Restoration preserves the
previous active/pinned/settled placement. Older clients/servers can
still apply timed-snooze early wakes; deploy updated clients and servers together.
Rolling back does not corrupt the database, but loses the manual-only policy.

Verify retained parking through time, failures, fresh questions/approvals and
messages; manual restore and optimistic rejection rollback; separate shelves,
route visibility, menus, Undo, drag and reconnect in an isolated client. Native
verification should show Backlog in Snoozed and restore from its detail/menu.

```sh
vp test run packages/client-runtime/src/state/threadSnoozed.test.ts packages/client-runtime/src/state/threadCommands.test.ts apps/server/src/orchestration-v2/ThreadSettlementService.test.ts apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts apps/server/src/mcp/toolkits/core.test.ts apps/server/src/provider/AgentContextBudget.test.ts apps/mobile/src/features/threads/threadListV2.test.ts
vp test run apps/web/src/components/Sidebar.backlog.browser.test.tsx apps/web/src/components/Sidebar.logic.browser.test.tsx
pnpm --dir evals mcp-tool-use --case backlog-until-manual-restore --model gpt-6.1-sol --shell-model gpt-6.1-terra --samples 1 --out runs/backlog-preservation
```

Side-chat activity is visible on web/desktop parent rows in both sidebar layouts,
using the project status ring and count with a tooltip breakdown and a selectable
child list. Keep the parent's own status separate. Side-chat shell subscriptions
retain streaming stability but update on completion, requests, visits and deletion.
Reuse server-first visit watermarks for unread results. The shared client shell
rolls running side chats into Working placement; requests, actionable plans,
failures and pending guest messages retain their attention priority. Native mobile
shares that placement while retaining its existing side-chat presentation.

The configured `thread.settle` shortcut targets the focused embedded side chat
throughout its pane, settles through the existing guarded action and closes only
that tab after success. Failure leaves it open. A reopened settled side chat closes
without toggling back to unsettled; the existing Un-settle action remains available.
Keep other thread shortcuts isolated from the parent, preserve main-thread
settle-and-advance, and retain side-chat history and Undo. Recursive side chats
remain disabled. No wire or persistence change is needed.

Owning paths are shared `state/{models,threadInbox,threadShell}.ts`, web
`sidebar/SidebarSideChatsStatus.tsx`, `SidebarThreadRow.tsx`, and
`chat/useChatShortcuts.ts` and `chat/useThreadLifecycle.tsx`.
The Working policy adapts upstream PR #28686; reconcile with it when it merges.
Verify Working-to-attention/completion transitions, ring counts and child navigation,
shortcut scope, failed settlement and retained history with:

```sh
vp test run packages/client-runtime/src/state/threadShell.test.ts packages/client-runtime/src/state/threadInbox.test.ts apps/web/src/components/Sidebar.logic.test.ts apps/mobile/src/features/threads/threadListV2.test.ts apps/web/src/components/chat/useChatShortcuts.browser.test.tsx apps/web/src/components/chat/useThreadLifecycle.browser.test.tsx apps/web/src/components/sidebar/SidebarSideChatsStatus.browser.test.tsx
vp run scenarios:prove scripts/scenarios/side-chat-settle-closes-tab.e2e.ts --base <personal-base> --head <feature-head>
```

The real-client proof must show the configured shortcut closing the side chat,
its status breakdown, and reopening with history; inspect mixed working, attention
and unread ring segments in both sidebar layouts.

## Maintenance and installation

Read [the operations guide](docs/operations/personal-fork.md) for explicit batched releases, daily upstream
inspection, weekly decisions and all-host deployment. `.t3-fork/` is ignored
installation-local configuration and runtime state, not product source.
The old Ubuntu sync timer is superseded; `scripts/personal-sync.sh` is a guard
that refuses to run the obsolete nested-agent workflow.

Claude Code uses Claude.ai subscription authentication only. Before launching it,
use the installed `claude-subscription-only` skill and its guarded launcher;
API/gateway/cloud-provider billing credentials are prohibited.
