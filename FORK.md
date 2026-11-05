# Ralf's T3 Code

The root of this repository is the product fork. Build personal features and
maintain its skills/tooling on `personal`. `main` follows `pingdotgg/t3code:main`
without personal commits; connect upstream history through ordinary merges.

Fetch `origin personal` and inspect status/history before starting work. Preserve
unfinished files and local commits; use a sibling worktree from the latest
`origin/personal` for independent work. Keep the canonical checkout on `personal`
so the maintenance worker's scripts remain available. Read upstream files with
Git or a worktree instead of switching the canonical checkout to `main`.

Use `.agents/skills/t3-fork-feature/SKILL.md` for feature work and
`.agents/skills/t3-fork-upstream/SKILL.md` for upstream integration.

## Intentional differences

Side chats inherit their parent's permission mode when created, including their
first turn, so starting a side conversation preserves the access already chosen
for that work. The side chat's mode can then be changed independently. Keep this
behavior in `ThreadForkService.ts`, `ProviderTurnStartService.ts`, and the web
`useSideChat.ts` hook; do not restore the upstream supervised overrides.

Verify with:

```sh
vp test run apps/server/src/orchestration-v2/ThreadFork.execution.test.ts apps/server/src/orchestration-v2/ProviderTurnStartService.test.ts -t 'side chat'
```

The fork also maintains project-local skills and coordinated deployment tooling
under `scripts/personal-fork/`.

Record each customization here with its intended behavior, owning paths, and a
focused verification command. Record intentional removals too, so an update
cannot silently restore them.

## Maintenance and installation

Read [the operations guide](docs/operations/personal-fork.md) for daily upstream
integration, weekly decisions and all-host deployment. `.t3-fork/` is ignored
installation-local configuration and runtime state, not product source.
The old Ubuntu sync timer is superseded; `scripts/personal-sync.sh` is a guard
that refuses to run the obsolete nested-agent workflow.
