"""Small stdlib-only host operations; also executed through SSH on Linux."""

import base64
import datetime
import json
import os
from pathlib import Path
import signal
import shlex
import sqlite3
import subprocess
import sys
import time
import urllib.request


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".next")
    with temp.open("w") as f:
        json.dump(value, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, path)


def database_busy(database, include_schedules=True):
    # A missing table/column is an error, not evidence that an unfamiliar version is idle.
    connection = sqlite3.connect(Path(database).as_uri() + "?mode=ro", uri=True, timeout=5)
    try:
        queries = {
            "runs": "SELECT count(*) FROM orchestration_v2_projection_runs WHERE completed_at IS NULL",
            "turns": "SELECT count(*) FROM orchestration_v2_projection_provider_turns WHERE completed_at IS NULL",
            "effects": "SELECT count(*) FROM orchestration_v2_effect_outbox WHERE status IN ('pending','running')",
            "requests": "SELECT count(*) FROM orchestration_v2_projection_runtime_requests WHERE resolved_at IS NULL AND status = 'pending'",
            "webhooks": "SELECT count(*) FROM scheduled_task_webhook_pending WHERE state IN ('pending','running')",
        }
        if include_schedules:
            queries["schedules"] = "SELECT count(*) FROM scheduled_tasks WHERE enabled = 1 AND (last_run_status = 'running' OR julianday(next_run_at) <= julianday('now', '+2 minutes'))"
        return {key: count for key, sql in queries.items() if (count := connection.execute(sql).fetchone()[0])}
    finally:
        connection.close()


def processes():
    result = {}
    for line in run("ps", "-axo", "pid=,ppid=,comm=").splitlines():
        pid, parent, command = line.strip().split(None, 2)
        if sys.platform.startswith("linux"):
            try:
                command = os.readlink(f"/proc/{pid}/exe")
            except OSError:
                pass
        result[int(pid)] = (int(parent), command)
    return result


def descendants(rows, pid):
    found = {pid}
    while True:
        new = found | {p for p, (parent, _) in rows.items() if parent in found}
        if new == found:
            return found - {pid}
        found = new


def infrastructure(host, pid, command):
    path = Path(command)
    if path.name == "t3-resource-monitor":
        return True
    if path.name == "codex":
        if sys.platform.startswith("linux"):
            args = Path(f"/proc/{pid}/cmdline").read_bytes().decode().split("\0")
        else:
            args = shlex.split(run("ps", "-p", str(pid), "-o", "args="))
        return len(args) > 1 and args[1] == "app-server"
    # Persistent MCP/code-mode transport processes can outlive a completed turn.
    # Arbitrary project Node processes and every shell still block the cutover.
    if command in {"/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node",
                   "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"}:
        return True
    return path.name == "codex-code-mode-host" and str(path).startswith(str(Path.home() / ".codex/packages/"))


def runtime(host):
    path = Path(host["home"]) / "userdata/server-runtime.json"
    rows = processes()
    metadata = json.loads(path.read_text()) if path.exists() else None
    pid = metadata["pid"] if metadata else None
    if host["platform"] == "linux":
        service_pid = int(run("systemctl", "--user", "show", host["service"], "--property=MainPID", "--value"))
        if service_pid == 0:
            return None, None, rows
        expected = (Path(host["install_root"]) / "current/t3").resolve()
        actual = Path(f"/proc/{service_pid}/exe").resolve()
        if service_pid != pid or actual != expected:
            raise RuntimeError("Service PID/runtime executable mismatch; refusing to operate")
        return service_pid, service_pid, rows
    executable = host["app"] + "/Contents/MacOS/T3 Code (Beta)"
    matches = {p for p, (_, cmd) in rows.items() if cmd == executable}
    if not matches:
        return None, None, rows
    if pid not in matches:
        raise RuntimeError("Running Mac app has no matching server runtime identity")
    root = rows[pid][0]
    if root not in matches:
        raise RuntimeError("Mac server parent is not the expected app executable")
    return pid, root, rows


def installed(host):
    if host["platform"] == "linux":
        path = Path(host["install_root"]) / "current/SOURCE_COMMIT"
    else:
        path = Path(host["app"]) / "Contents/Resources/SOURCE_COMMIT"
        if not path.exists():
            path = Path(host["installed_record"])
    return path.read_text().strip()


def target_path(host, commit):
    if host["platform"] == "linux":
        return Path(host["install_root"]) / "releases" / commit
    return Path(host["stage_root"]) / commit / "T3 Code (Personal).app"


def target_ready(host, commit):
    target = target_path(host, commit)
    marker = target / ("SOURCE_COMMIT" if host["platform"] == "linux" else "Contents/Resources/SOURCE_COMMIT")
    ready = target / ("READY" if host["platform"] == "linux" else "Contents/Resources/MAINTENANCE_READY")
    return marker.exists() and marker.read_text().strip() == commit and ready.is_file()


def probe(host, commit=None):
    pid, root, rows = runtime(host)
    busy = database_busy(Path(host["home"]) / "userdata/statev2.sqlite")
    # Any resident agent, shell or project process postpones a cutover, including idle shells.
    child_ids = descendants(rows, pid) if pid else set()
    extra = [p for p in child_ids if not infrastructure(host, p, rows[p][1])]
    if extra:
        busy["application_subprocesses"] = len(extra)
    if pid:
        with urllib.request.urlopen(host["health_url"], timeout=5) as response:
            if response.status != 200:
                raise RuntimeError("Environment health check failed")
            json.load(response)
    return {"id": host["id"], "installed": installed(host), "running": pid is not None,
            "pid": pid, "root_pid": root, "busy": busy,
            "target_ready": target_ready(host, commit) if commit else None}


def stop(host, expected):
    current = probe(host)
    if current["installed"] != expected or current["busy"]:
        raise RuntimeError("Host changed or became busy before shutdown")
    if not current["running"]:
        return
    if host["platform"] == "linux":
        run("systemctl", "--user", "stop", host["service"])
    else:
        # Only the exact app parent captured and verified by runtime(), never a name-pattern kill.
        os.kill(current["root_pid"], signal.SIGTERM)
    deadline = time.monotonic() + 50
    while True:
        if host["platform"] == "linux":
            remaining = int(run("systemctl", "--user", "show", host["service"], "--property=MainPID", "--value")) != 0
        else:
            rows = processes()
            executable = host["app"] + "/Contents/MacOS/T3 Code (Beta)"
            remaining = any(rows.get(p, (None, None))[1] == executable for p in (current["pid"], current["root_pid"]))
        if not remaining:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError("Timed out waiting for host shutdown")
        time.sleep(0.5)


def stopped_check(host):
    if runtime(host)[0] is not None:
        raise RuntimeError("Host must be stopped")
    busy = database_busy(Path(host["home"]) / "userdata/statev2.sqlite", include_schedules=False)
    if busy:
        raise RuntimeError(f"Queued work remains after shutdown: {busy}")


def backup(host, commit):
    stopped_check(host)
    root = Path(host.get("install_root", host["home"])) / "maintenance-backups" / commit
    root.mkdir(parents=True, exist_ok=True)
    destination = root / (datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".sqlite")
    source = sqlite3.connect((Path(host["home"]) / "userdata/statev2.sqlite").as_uri() + "?mode=ro", uri=True)
    try:
        target = sqlite3.connect(destination)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()
    return str(destination)


def activate(host, commit):
    stopped_check(host)
    if not target_ready(host, commit):
        raise RuntimeError("Target artifact is not ready")
    target = target_path(host, commit)
    if host["platform"] == "linux":
        current = Path(host["install_root"]) / "current"
        next_path = current.with_name("current.maintenance-next")
        next_path.symlink_to(target)
        os.replace(next_path, current)
    else:
        app = Path(host["app"])
        previous = Path(host["stage_root"]) / commit / "previous.app"
        if previous.exists():
            raise RuntimeError("Previous app backup already exists; inspect the prior cutover")
        os.rename(app, previous)
        os.rename(target, app)


def start(host):
    if host["platform"] == "linux":
        run("systemctl", "--user", "start", host["service"])
    else:
        run("open", "-a", host["app"])


def restore_before_start(host, attempted, previous):
    stopped_check(host)
    if host["platform"] == "linux":
        target = Path(host["install_root"]) / "releases" / previous
        if (target / "SOURCE_COMMIT").read_text().strip() != previous:
            raise RuntimeError("Original release identity cannot be verified")
        current = Path(host["install_root"]) / "current"
        next_path = current.with_name("current.maintenance-restore")
        next_path.symlink_to(target)
        os.replace(next_path, current)
    else:
        directory = Path(host["stage_root"]) / attempted
        backup = directory / "previous.app"
        app = Path(host["app"])
        if backup.exists():
            marker = backup / "Contents/Resources/SOURCE_COMMIT"
            original = marker.read_text().strip() if marker.exists() else Path(host["installed_record"]).read_text().strip()
            if original != previous:
                raise RuntimeError("Original app identity cannot be verified")
            if app.exists():
                os.rename(app, directory / "failed.app")
            os.rename(backup, app)
    if installed(host) != previous:
        raise RuntimeError("Original installation was not restored")


def verify(host, commit):
    deadline = time.monotonic() + 50
    last = None
    while time.monotonic() < deadline:
        try:
            value = probe(host)
            if value["running"] and value["installed"] == commit:
                return value
        except Exception as error:
            last = str(error)
        time.sleep(1)
    raise RuntimeError(f"New environment failed verification: {last}")


def main():
    operation, encoded, *args = sys.argv[1:]
    host = json.loads(base64.urlsafe_b64decode(encoded))
    functions = {"probe": probe, "stop": stop, "backup": backup, "activate": activate,
                 "start": start, "verify": verify, "stopped-check": stopped_check,
                 "restore-before-start": restore_before_start}
    result = functions[operation](host, *args)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
