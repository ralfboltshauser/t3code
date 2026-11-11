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

Feature work follows `t3-fork-feature` and ends ready on a pushed feature branch.
Only an explicit `t3-fork-release` / "merge and build" request gathers ready
features plus upstream and stages a release. Side chats share their parent's
feature. Daily maintenance inspects upstream without publishing.

## Intentional differences

Idle independent chats can move to a linked machine through `/move`, the web chat
menu or palette, and the native move screen. Move recent portable text and captured
Git work into an operation-owned destination worktree, with optional continuation;
blank moves never start a provider turn. Keep the source fenced during uncertainty,
replay the original import/continuation receipt, retain source files, and use a fresh
operation for return moves. No active/deferred self-handoff or implicit process,
attachment, credential, goal, schedule or watch migration. Both servers advertise
`threadHandoffProtocol: 1`; old clients remain subject to server fencing. Do not run
an older server against threads with pending or completed moves: it lacks that fence.

Owning modules are `peer/handoff/{ThreadHandoff,HandoffImport,HandoffGit}.ts` and
`orchestration-v2/ThreadImportService.ts`. Upstream merges must preserve native
imported history in `thread.create`, the normal `ThreadLaunchService` setup path,
workspace admission/queued-start fences in `Orchestrator.ts`, projection metadata,
guarded RPCs, peer forwarding, and web/native entry points. Reconcile with upstream’s
import/Git/handoff stack rather than retaining duplicate implementations when it lands.

```sh
vp test run apps/server/src/peer/handoff apps/server/src/orchestration-v2/ThreadImportService.test.ts packages/client-runtime/src/state/commandPermissions.test.ts
```

These checks cover source staging preservation, Git failure cleanup, immutable
retry identity, lost replies and changed link grants, original continuation receipts,
blank imports, and the server’s move fence. Real peer verification uses isolated
databases/clones; never experiment with a live chat’s ownership.

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
vp test run packages/shared/src/t3ProjectFile.test.ts apps/web/src/hooks/useHandleNewThread.test.ts apps/mobile/src/features/threads/new-task-context-presentation.test.ts apps/mobile/src/state/pending-new-tasks-model.test.ts
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
vp test run packages/client-runtime/src/sidebarProfiles.test.ts apps/desktop/src/settings/DesktopSidebarProfiles.test.ts apps/web/src/sidebarProfilesStorage.browser.test.ts apps/web/src/components/SidebarProfiles.browser.test.tsx apps/mobile/src/state/sidebar-profiles.test.tsx apps/web/src/components/SidebarProfiles.startup.browser.test.tsx
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
stage. Independent host builds overlap, while every required host must validate
before queuing. Mac bundles become visible only after signing and strict
verification at a temporary path. Shared `testing/longTempDir.ts` canonicalizes
Darwin temp aliases without removing explicit symlink test coverage.
Verify failed/interrupted/stale checks, mixed-source rejection, concurrent build
failure preservation and failed-signing invisibility with:

```sh
python3 -m unittest discover -s scripts/personal-fork -p 'test_*.py'
vp test run scripts/check-changed.test.ts packages/shared/src/testing/longTempDir.test.ts
```

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

## Maintenance and installation

Read [the operations guide](docs/operations/personal-fork.md) for explicit batched releases, daily upstream
inspection, weekly decisions and all-host deployment. `.t3-fork/` is ignored
installation-local configuration and runtime state, not product source.
The old Ubuntu sync timer is superseded; `scripts/personal-sync.sh` is a guard
that refuses to run the obsolete nested-agent workflow.

Claude Code uses Claude.ai subscription authentication only. Before launching it,
use the installed `claude-subscription-only` skill and its guarded launcher;
API/gateway/cloud-provider billing credentials are prohibited.
