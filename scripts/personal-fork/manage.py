#!/usr/bin/env python3
"""Build one exact revision everywhere, then cut over only an idle cohort."""

import argparse
import base64
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from host import atomic_json
from layout import ROOT, LOCAL, STATE, SCRIPTS



def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run(*args, capture=True, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip() if capture else subprocess.run(args, check=True, **kwargs)


def inventory():
    path = LOCAL / "hosts.json"
    if not path.is_file():
        raise RuntimeError(f"Host inventory missing: {path}; configure this installation before deploying")
    config = json.loads(path.read_text())
    hosts = config["hosts"]
    if len({h["id"] for h in hosts}) != len(hosts) or len([h for h in hosts if h["transport"] == "local"]) != 1:
        raise RuntimeError("Inventory must have unique host IDs and exactly one local Mac")
    for h in hosts:
        if h["transport"] == "local" and (h["platform"], h["arch"]) != ("mac", "arm64"):
            raise RuntimeError("Local builder currently supports Mac ARM64 only")
        if h["transport"] not in ("local", "ssh") or (h["transport"] == "ssh" and h["platform"] != "linux"):
            raise RuntimeError("Unsupported host transport/platform; add support before deploying")
    return config


def fingerprint(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


def host_call(host, operation, *args):
    host = dict(host, stage_root=str(LOCAL / "staging"))
    encoded = base64.urlsafe_b64encode(json.dumps(host).encode()).decode()
    command = ["python3", "-", operation, encoded, *args]
    script = (SCRIPTS / "host.py").read_text()
    if host["transport"] == "ssh":
        command = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3", host["ssh"], shlex.join(command)]
    else:
        command[0] = sys.executable
    result = run(*command, input=script, timeout=110)
    return json.loads(result)


@contextlib.contextmanager
def locked(name):
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / (name + ".lock")).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def status():
    config = inventory()
    result = {"observed_at": now(), "hosts": []}
    for host in config["hosts"]:
        try:
            result["hosts"].append(host_call(host, "probe"))
        except Exception as error:
            result["hosts"].append({"id": host["id"], "error": str(error)})
    for name in ("pending", "deployment", "last-deployment"):
        path = STATE / (name + ".json")
        if path.exists():
            result[name] = json.loads(path.read_text())
    print(json.dumps(result, indent=2))
    return result


def pending_release(commit):
    if (STATE / "deployment.json").exists():
        raise RuntimeError("Resolve the previous deployment journal before staging")
    path = STATE / "pending.json"
    previous = json.loads(path.read_text()) if path.exists() else None
    if previous and previous["commit"] != commit:
        try:
            run("git", "-C", str(ROOT), "merge-base", "--is-ancestor", previous["commit"], commit)
        except subprocess.CalledProcessError as error:
            raise RuntimeError("Queued release is not an ancestor; reconcile it before replacement") from error
    return previous


def stage(commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Supply a full 40-character source commit")
    with locked("release"):
        pending = STATE / "pending.json"
        previous = pending_release(commit)
        config = inventory()
        # Establish reachability before doing expensive builds. Busy hosts may build safely.
        for host in config["hosts"]:
            host_call(host, "probe")
        repo = ROOT
        if run("git", "-C", str(repo), "remote", "get-url", "origin") != config["origin"]:
            raise RuntimeError("Unexpected fork origin")
        run("git", "-C", str(repo), "fetch", "origin", "refs/heads/personal:refs/remotes/origin/personal", capture=False)
        run("git", "-C", str(repo), "merge-base", "--is-ancestor", commit, "origin/personal")
        build = LOCAL / "builds" / ("mac-" + commit)
        if not build.exists():
            build.parent.mkdir(exist_ok=True)
            run("git", "clone", "--shared", "--no-checkout", str(repo), str(build), capture=False)
            run("git", "-C", str(build), "remote", "set-url", "origin", config["origin"])
            # Shared clones may borrow a partial object store; allow checkout to fetch missing blobs.
            run("git", "-C", str(build), "config", "remote.origin.promisor", "true")
            run("git", "-C", str(build), "config", "remote.origin.partialclonefilter", "blob:none")
            run("git", "-C", str(build), "checkout", "--detach", commit, capture=False)
        if run("git", "-C", str(build), "rev-parse", "HEAD") != commit or run("git", "-C", str(build), "status", "--porcelain"):
            raise RuntimeError("Build checkout has changes or the wrong revision; preserve and inspect it")
        for host in config["hosts"]:
            if host_call(host, "probe", commit)["target_ready"]:
                continue
            if host["transport"] == "local":
                destination = LOCAL / "staging" / commit
                destination.mkdir(parents=True, exist_ok=True)
                run("bash", str(SCRIPTS / "build-mac.sh"), str(LOCAL), str(build), commit, str(destination), str(LOCAL / "settings.json"), str(LOCAL / "hosts.json"), capture=False)
            else:
                args = ["bash", "-s", "--", host["repo"], host["install_root"], commit, host["arch"], config["origin"]]
                run("ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host["ssh"], shlex.join(args), input=(SCRIPTS / "build-linux.sh").read_text(), text=True, capture=False)
        for host in config["hosts"]:
            if not host_call(host, "probe", commit)["target_ready"]:
                raise RuntimeError("A host has no verified staged artifact")
        if previous and previous["commit"] != commit:
            atomic_json(STATE / "superseded" / (previous["commit"] + ".json"), previous)
            (STATE / "idle-observation.json").unlink(missing_ok=True)
        atomic_json(pending, {"commit": commit, "inventory_sha256": fingerprint(config), "queued_at": now()})
        print(f"Queued {commit} for all {len(config['hosts'])} hosts; installation waits for idle.")


def deploy():
    pending = STATE / "pending.json"
    if not pending.exists():
        return
    with locked("release"):
        journal_path = STATE / "deployment.json"
        if journal_path.exists():
            raise RuntimeError("Previous cutover needs recovery; automatic retries stopped")
        config = inventory()
        release = json.loads(pending.read_text())
        commit = release["commit"]
        if release["inventory_sha256"] != fingerprint(config):
            raise RuntimeError("Inventory changed after staging; rebuild the complete cohort")
        observed = [host_call(h, "probe", commit) for h in config["hosts"]]
        if all(p["installed"] == commit for p in observed):
            pending.unlink()
            return
        if len({p["installed"] for p in observed}) != 1:
            raise RuntimeError("Installed cohort is already split; reconcile it before deployment")
        if any(p["busy"] or not p["target_ready"] for p in observed):
            (STATE / "idle-observation.json").unlink(missing_ok=True)
            print("Postponed: a host is busy or an artifact is unavailable.", flush=True)
            return
        idle_path = STATE / "idle-observation.json"
        idle = json.loads(idle_path.read_text()) if idle_path.exists() else None
        if not idle or idle["commit"] != commit or idle["inventory_sha256"] != fingerprint(config) or time.time() - idle["at"] > 900:
            atomic_json(idle_path, {"commit": commit, "inventory_sha256": fingerprint(config), "at": time.time()})
            print("First idle observation; waiting for a second observation.", flush=True)
            return
        if time.time() - idle["at"] < 60:
            return
        journal = {"commit": commit, "started_at": now(), "phase": "stopping", "before": observed, "hosts": {}}
        atomic_json(journal_path, journal)
        try:
            for host, before in zip(config["hosts"], observed):
                host_call(host, "stop", before["installed"])
                journal["hosts"][host["id"]] = {"stopped": True}
                atomic_json(journal_path, journal)
            for host in config["hosts"]:
                host_call(host, "stopped-check")
                journal["hosts"][host["id"]]["database_backup"] = host_call(host, "backup", commit)
                atomic_json(journal_path, journal)
            journal["phase"] = "activating"
            atomic_json(journal_path, journal)
            for host in config["hosts"]:
                host_call(host, "activate", commit)
                journal["hosts"][host["id"]]["activated"] = True
                atomic_json(journal_path, journal)
            # From here on, starting a server may migrate its database. Never auto-roll back.
            journal["phase"] = "starting"
            atomic_json(journal_path, journal)
            for host in config["hosts"]:
                host_call(host, "start")
                journal["hosts"][host["id"]]["started"] = True
                atomic_json(journal_path, journal)
            for host in config["hosts"]:
                journal["hosts"][host["id"]]["verified"] = host_call(host, "verify", commit)
                atomic_json(journal_path, journal)
            local = next(h for h in config["hosts"] if h["transport"] == "local")
            Path(local["installed_record"]).write_text(commit + "\n")
            journal.update(phase="complete", completed_at=now())
            atomic_json(STATE / "last-deployment.json", journal)
            pending.unlink()
            journal_path.unlink()
            idle_path.unlink(missing_ok=True)
            print(f"Verified {commit} running on every inventory host.", flush=True)
        except Exception as error:
            journal.update(error=str(error), failed_at=now())
            atomic_json(journal_path, journal)
            # Pointer-only failures are reversible while every new server is still stopped.
            if journal["phase"] == "activating":
                try:
                    for host, before in zip(config["hosts"], observed):
                        host_call(host, "restore-before-start", commit, before["installed"])
                        journal["hosts"][host["id"]]["restored_before_start"] = True
                        atomic_json(journal_path, journal)
                    journal["phase"] = "restored-before-start"
                    atomic_json(journal_path, journal)
                except Exception as restore_error:
                    journal["restore_error"] = str(restore_error)
                    atomic_json(journal_path, journal)
            if journal["phase"] in ("stopping", "restored-before-start"):
                for host, before in zip(config["hosts"], observed):
                    if before["running"] and journal["hosts"].get(host["id"], {}).get("stopped"):
                        try:
                            host_call(host, "start")
                        except Exception:
                            pass
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["status", "stage", "deploy", "lock-run", "paths"])
    parser.add_argument("commit", nargs="?")
    args = parser.parse_args()
    if args.command == "paths":
        print(json.dumps({"repository": str(ROOT), "local": str(LOCAL), "state": str(STATE)}, indent=2))
    elif args.command == "status":
        status()
    elif args.command == "stage":
        if args.commit is None:
            parser.error("stage requires a full commit SHA")
        stage(args.commit)
    elif args.command == "deploy":
        deploy()
    else:
        with locked("integration"):
            print("Integration lock acquired; close stdin to release.", flush=True)
            sys.stdin.read()


if __name__ == "__main__":
    try:
        main()
    except BlockingIOError:
        print("Another maintenance operation holds the lock; postponed.", file=sys.stderr)
        sys.exit(0)
    except Exception as error:
        print(f"Maintenance stopped: {error}", file=sys.stderr)
        sys.exit(1)
