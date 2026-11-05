#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")" && pwd)"
git -C "$project_dir" fetch origin refs/heads/personal:refs/remotes/origin/personal
commit="$(git -C "$project_dir" rev-parse origin/personal)"
exec python3 "$project_dir/scripts/personal-fork/manage.py" stage "$commit"
