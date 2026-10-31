#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Upstream sync failed at line $LINENO. See the service journal." >&2' ERR

export PATH="$HOME/.local/bin:$HOME/.local/share/vite-plus/bin:$HOME/.vite-plus/bin:$PATH"
repo=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)
state="${XDG_STATE_HOME:-$HOME/.local/state}/t3code-upstream-sync"
worktree="$(dirname "$repo")/t3code-upstream-sync"
mkdir -p "$state"
exec 9>"$state/lock"
flock -n 9 || exit 0

case "${1:-}" in
  ""|--check) ;;
  *) echo "Usage: $0 [--check]" >&2; exit 2 ;;
esac
case "$(git -C "$repo" config --get remote.origin.url)" in
  https://github.com/ralfboltshauser/t3code.git|git@github.com:ralfboltshauser/t3code.git) ;;
  *) echo 'Refusing to sync an unexpected origin.' >&2; exit 1 ;;
esac
case "$(git -C "$repo" config --get remote.upstream.url)" in
  https://github.com/pingdotgg/t3code.git) ;;
  *) echo 'Refusing to sync an unexpected upstream.' >&2; exit 1 ;;
esac

git -C "$repo" fetch --quiet origin \
  refs/heads/main:refs/remotes/origin/main \
  refs/heads/personal:refs/remotes/origin/personal
git -C "$repo" fetch --quiet upstream refs/heads/main:refs/remotes/upstream/main
target=$(git -C "$repo" rev-parse upstream/main)
base=$(git -C "$repo" rev-parse origin/personal)
git -C "$repo" merge-base --is-ancestor origin/main "$target" || {
  echo 'main has diverged from upstream; inspect it before retrying.' >&2
  exit 1
}
if [[ ${1:-} == --check ]]; then
  git -C "$repo" rev-list --left-right --count "origin/personal...upstream/main"
  echo 'Counts: personal-only commits, then upstream commits still to integrate.'
  exit 0
fi
git -C "$repo" push --quiet origin "$target:refs/heads/main"
if git -C "$repo" merge-base --is-ancestor "$target" "$base"; then
  echo "Already contains upstream $target; no agent needed."
  exit 0
fi
if [[ -e $worktree ]]; then
  echo "Previous candidate still exists at $worktree. Inspect it; daily sync will not overwrite it." >&2
  exit 1
fi

# Keep unattended runs on the existing subscription login, without API-key fallback.
if ! env -u OPENAI_API_KEY -u CODEX_API_KEY codex login status 2>&1 | grep -Fxq 'Logged in using ChatGPT'; then
  echo 'ChatGPT subscription login unavailable. Run codex login; API billing will not be used.' >&2
  exit 1
fi
git -C "$repo" worktree add --detach "$worktree" "$base"
trap 'echo "Sync stopped. Candidate: $worktree; logs: $state" >&2' ERR
cd "$worktree"
vp install --frozen-lockfile
env -u OPENAI_API_KEY -u CODEX_API_KEY codex exec \
  -C "$worktree" --sandbox workspace-write --add-dir "$repo" \
  -c 'sandbox_workspace_write.network_access=true' \
  -c 'approval_policy="never"' -c 'forced_login_method="chatgpt"' \
  --output-last-message "$state/last-agent-report.md" \
  "Read .agents/skills/t3-personal-fork/SKILL.md and follow its upstream-update procedure. Merge exactly $target into this detached candidate based on $base. Preserve the intentional behavior recorded in FORK.md. This daily merge is authorized. Resolve conflicts and run the customization-specific checks, then commit the result. Do not push or change another worktree. The launcher runs check:changed and promotes the checked commit only if all checks pass. If intent is ambiguous or checks cannot be completed, leave the candidate and explain the blocker."

if [[ -e .personal-sync-blocked ]]; then
  echo 'Agent reported a blocker. Keeping the candidate and its report for inspection.' >&2
  exit 1
fi
git merge-base --is-ancestor "$target" HEAD
git merge-base --is-ancestor "$base" HEAD
python3 scripts/personal-sync.test.py
vp run check:changed "$target"
if [[ -n $(git status --porcelain) ]]; then
  echo 'Candidate has uncommitted files; keeping it for inspection.' >&2
  exit 1
fi
# A normal push rejects concurrent personal changes rather than discarding them.
git push origin HEAD:refs/heads/personal
cd "$repo"
git worktree remove "$worktree"
trap - ERR
echo "Updated personal with upstream $target. Local development branches were left alone."
