# Ralf's T3 Code

Build personal features on `personal`, the default branch. `main` follows
`pingdotgg/t3code:main` without personal commits. Both histories stay connected
through ordinary merges.

The local checkout is `/home/ralf/prj/exploration/t3code-personal`.
Before starting new work, fetch `origin personal` and inspect the working tree
and branch history. A daily update may have advanced GitHub without changing your
checked-out files. On a clean `personal` branch that can fast-forward, run
`git pull --ff-only origin personal`. Preserve unfinished work; use a sibling
worktree from `origin/personal` for independent work rather than committing
someone else's changes. If local commits diverge, inspect and merge them with
`origin/personal`; do not reset them away.

Use the `t3-personal-fork` skill when adding a customization or absorbing an
upstream update. Keep product changes focused and upstream connection points small.

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

The other fork additions are this guide, the local maintenance skill, and
`scripts/personal-sync.sh`.

Record each customization here with its intended behavior, owning paths, and a
focused verification command. Record intentional removals too, so an update
cannot silently restore them.

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

## Updating the local installation

A push updates the source on GitHub. It does not install that source. The daily
sync also stops at publishing `personal`; deployment is a separate operation.

The Ubuntu server runs as the user service `t3code-personal.service`, using
`~/.local/share/t3code-personal/current/t3` on port 3773. `current` points to a
release under `releases/<full-commit-sha>`. Persistent state lives in
`~/.local/share/t3code-personal/data`, outside both the checkout and release.
Check these paths against `systemctl --user cat t3code-personal.service` before
using this procedure on another installation.

Inspect the installed revision without starting or stopping anything:

```sh
readlink -f ~/.local/share/t3code-personal/current
cat ~/.local/share/t3code-personal/current/SOURCE_COMMIT
systemctl --user is-active t3code-personal.service
```

### Prepare and verify a release

Use a clean checkout of the chosen pushed `personal` commit. If the development
checkout is busy, create a sibling build worktree. Complete the customization
checks and `vp run check:changed upstream/main` there. Build before interrupting
the running service.

The commands below follow the existing CLI archive builders and Linux x64 release
workflow. They have been checked against the source, but this full local build
and cutover procedure has not yet been exercised end to end. Use Bash with
`set -euo pipefail` and stop on any failure. Install dependencies with `vp i` after
any worktree setup has finished. The build needs Rust, `patchelf`, `libatomic1`,
and the exact Node version from `package.json`; the server's executable builder
rejects a different Node version. This machine keeps build Node versions under
`~/.local/share/t3code-personal/tooling/`. If the pinned version is missing,
install it there before continuing.

From the clean build checkout:

```sh
t3_source_commit=$(git rev-parse HEAD)
t3_install_root="$HOME/.local/share/t3code-personal"
t3_build_dir="$t3_install_root/artifacts/$t3_source_commit"
t3_node_version=$(node -p 'require("./package.json").engines.node')
export PATH="$t3_install_root/tooling/node-v$t3_node_version-linux-x64/bin:$PATH"
test "$(node --version)" = "v$t3_node_version"
t3_archive_version=$(node -p 'require("./apps/server/package.json").version')
mkdir -p "$t3_build_dir/resource-monitor/linux-x64"
vp run --filter t3 build
node apps/server/scripts/cli.ts build-exe --verbose
cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target x86_64-unknown-linux-gnu
cp native/resource-monitor/target/x86_64-unknown-linux-gnu/release/t3-resource-monitor "$t3_build_dir/resource-monitor/linux-x64/"
node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$t3_archive_version" --resource-monitor-dir "$t3_build_dir/resource-monitor" --output-dir "$t3_build_dir"
t3_archive="$t3_build_dir/t3-$t3_archive_version-linux-x64.tar.gz"
node scripts/smoke-cli-archive.ts --archive "$t3_archive" --expect-version "$t3_archive_version"
sha256sum "$t3_archive" > "$t3_archive.sha256"
```

The smoke test extracts the archive and serves it with temporary state; it does
not use the live database. Keep the archive and its SHA-256 sidecar.
Extract the verified archive into a new `releases/$t3_source_commit` directory
with `tar --strip-components=1`, and write the full source SHA to its
`SOURCE_COMMIT`. Keep releases immutable; an existing directory for that SHA
should be inspected and reused only if its provenance is known.

### Activate and recover

A restart disconnects clients and interrupts active agent turns. When installation
is requested, prepare the verified release first, then arrange the cutover when
those turns are stopped. If the current conversation depends on this server,
hand off the restart so the process does not terminate its own verification.

Record the previous `current` target. Stop `t3code-personal.service`, switch
`current` to the prepared release using a temporary symlink and an atomic rename,
and start the service. Confirm it is active, inspect its journal for startup
errors, check `curl --fail http://127.0.0.1:3773/`, then reconnect a real client
and exercise the changed behavior. Report the installed source SHA and any
verification still outstanding. Never print pairing tokens or credentials.

If startup fails, stop the service, switch `current` back to the recorded release,
and start it again. Retain the failed release and logs for diagnosis. A binary
rollback does not undo database migrations; before deploying a release with
schema changes, establish its backup and restore procedure. Run pre-install
smoke tests against isolated state, and never restore old state over newer user
work.
