#!/usr/bin/env python3
"""Install the logged-in Mac user's idle deployment worker."""

import os
from pathlib import Path
import plistlib
import shutil
import subprocess

from layout import ROOT, LOCAL, STATE, settings

LABEL = settings().get("worker_label", "com.t3code.fork-deploy")
path = Path.home() / "Library/LaunchAgents" / (LABEL + ".plist")
path.parent.mkdir(parents=True, exist_ok=True)
STATE.mkdir(parents=True, exist_ok=True)
spec = {
    "Label": LABEL,
    "ProgramArguments": [shutil.which("python3"), str(ROOT / "scripts/personal-fork/manage.py"), "deploy"],
    "WorkingDirectory": str(ROOT),
    "StartInterval": 300,
    "RunAtLoad": True,
    "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"},
    "StandardOutPath": str(STATE / "deploy.log"),
    "StandardErrorPath": str(STATE / "deploy-error.log"),
    "ProcessType": "Background",
}
domain = f"gui/{os.getuid()}"
loaded = subprocess.run(["launchctl", "print", domain + "/" + LABEL], capture_output=True).returncode == 0
content = plistlib.dumps(spec)
if loaded:
    if not path.exists() or path.read_bytes() != content:
        raise SystemExit("Existing worker configuration differs; stop it when no cutover is running before reinstalling.")
    print("Deployment worker already installed.")
else:
    path.write_bytes(content)
    subprocess.run(["plutil", "-lint", str(path)], check=True)
    subprocess.run(["launchctl", "bootstrap", domain, str(path)], check=True)
    print("Deployment worker installed; retries every five minutes while logged in and awake.")
