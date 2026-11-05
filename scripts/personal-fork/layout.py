"""Locate shared local installation state from any worktree of this fork."""

import json
from pathlib import Path
import subprocess


def shared_root(checkout):
    common = subprocess.check_output(
        ["git", "-C", str(checkout), "rev-parse", "--path-format=absolute", "--git-common-dir"],
        text=True,
    ).strip()
    path = Path(common).resolve()
    if path.name != ".git":
        raise RuntimeError("Maintenance requires a non-bare canonical checkout")
    return path.parent


CHECKOUT = Path(__file__).resolve().parents[2]
ROOT = shared_root(CHECKOUT)
LOCAL = ROOT / ".t3-fork"
STATE = LOCAL / "state"
SCRIPTS = CHECKOUT / "scripts/personal-fork"


def settings():
    path = LOCAL / "settings.json"
    if not path.is_file():
        raise RuntimeError(f"Local installation settings missing: {path}; see docs/operations/personal-fork.md")
    return json.loads(path.read_text())
