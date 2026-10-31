# Ralf's T3 Code

Build personal features on `personal`, the default branch. `main` follows
`pingdotgg/t3code:main` without personal commits. Both histories stay connected
through ordinary merges.

The local checkout is `/home/ralf/prj/exploration/t3code-personal`.
Before starting new work, commit any unfinished work and run
`git pull --ff-only origin personal`. A daily update may have advanced GitHub
without changing your checked-out files. If the branches diverged, inspect and
merge your local work with `origin/personal`; do not reset it away.

Use the `t3-personal-fork` skill when adding a customization or absorbing an
upstream update. Keep product changes focused and upstream connection points small.

## Intentional differences

Currently there are no personal product changes. The only fork additions are this
guide, the local maintenance skill, and `scripts/personal-sync.sh`.

When adding a feature, replace this paragraph with its intended behavior, why it
differs from upstream, owning paths, and a focused test command or manual check.
Record intentional removals too, so an update cannot silently restore them.

## Daily updates

On Ralf's Ubuntu machine, `t3code-upstream-sync.timer` runs daily at **07:17
Europe/Zurich**, catching up after downtime. It uses the existing GitHub and
ChatGPT subscription logins. It runs an agent only when upstream has new commits.
There is no API-key fallback or hosted CI setup.

The launcher fast-forwards GitHub's `main`, creates a sibling candidate worktree,
and asks Codex to follow the skill. After the agent commits its merge and repairs,
the launcher runs `vp run check:changed` against the pinned upstream commit. A
clean, passing candidate is pushed to `personal`. A normal push protects against
concurrent changes. Your development checkout and running installation stay as-is.

```sh
# Fetch and compare, without pushing or starting an agent:
bash scripts/personal-sync.sh --check

# Trigger the same daily task now:
systemctl --user start t3code-upstream-sync.service

# Read the result or pause the schedule:
journalctl --user -u t3code-upstream-sync.service -n 100 --no-pager
systemctl --user disable --now t3code-upstream-sync.timer
```

Agent reports live in `~/.local/state/t3code-upstream-sync/last-agent-report.md`.
On failure the candidate stays at
`/home/ralf/prj/exploration/t3code-upstream-sync`; future runs stop there rather
than overwrite unfinished repairs. Inspect the journal and candidate, finish
the merge, run the checks above plus the feature checks, and push it normally to
`personal`. Then remove that clean worktree with `git worktree remove` and rerun
the service. If abandoning a failed candidate, inspect it before removing it.

GitHub Actions is disabled in this fork: inherited release/deployment workflows
target upstream's infrastructure. Enable only workflows you have adapted for
the fork. The daily task is a local systemd user timer and needs this machine on;
it does not need the Codex desktop app open.
