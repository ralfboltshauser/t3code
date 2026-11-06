"""Exercise cohort safety with simulated hosts and real read-only SQLite reads."""

import contextlib
import io
import json
import os
import plistlib
import sys
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

import host
import manage
import layout
import subprocess
import threading


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.config = {"hosts": [{"id": "mac", "transport": "local", "installed_record": str(self.root / "INSTALLED_COMMIT")},
                                 {"id": "ubuntu", "transport": "ssh"}]}
        self.target = "b" * 40
        self.old = "a" * 40
        self.operations = []
        self.busy = {}
        self.fail = None
        self.installed = {h["id"]: self.old for h in self.config["hosts"]}
        self.running = {h["id"]: True for h in self.config["hosts"]}
        for target, value in (("ROOT", self.root), ("STATE", self.root)):
            p = patch.object(manage, target, value)
            p.start()
            self.addCleanup(p.stop)
        for target, value in (("inventory", lambda: self.config), ("host_call", self.host_call)):
            p = patch.object(manage, target, value)
            p.start()
            self.addCleanup(p.stop)
        self.write_pending()
        host.atomic_json(self.root / "idle-observation.json", {"commit": self.target, "inventory_sha256": manage.fingerprint(self.config), "at": time.time() - 120})

    def write_pending(self):
        host.atomic_json(self.root / "pending.json", {"commit": self.target, "inventory_sha256": manage.fingerprint(self.config)})

    def host_call(self, h, operation, *args):
        name = h["id"]
        self.operations.append((name, operation))
        if self.fail == (name, operation):
            raise RuntimeError("simulated host failure")
        if operation == "probe":
            return {"id": name, "busy": self.busy.get(name, {}), "installed": self.installed[name], "target_ready": True, "running": self.running[name]}
        if operation == "stop":
            self.running[name] = False
        elif operation == "activate":
            self.installed[name] = args[0]
        elif operation == "restore-before-start":
            self.installed[name] = args[1]
        elif operation == "start":
            self.running[name] = True
        elif operation == "verify":
            if self.installed[name] != args[0] or not self.running[name]:
                raise AssertionError("Incorrect cohort state")
            return {"installed": self.installed[name], "running": True}
        elif operation == "backup":
            return "/recovery/snapshot.sqlite"

    def deploy(self):
        with contextlib.redirect_stdout(io.StringIO()):
            manage.deploy()

    def test_busy_host_postpones_everyone(self):
        self.busy["ubuntu"] = {"turns": 1}
        self.deploy()
        self.assertEqual(self.operations, [("mac", "probe"), ("ubuntu", "probe")])
        self.assertFalse((self.root / "deployment.json").exists())
        self.assertFalse((self.root / "idle-observation.json").exists())

    def test_unreachable_host_never_stops_other_host(self):
        self.fail = ("ubuntu", "probe")
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertTrue(all(self.running.values()))
        self.assertEqual(set(self.installed.values()), {self.old})

    def test_first_idle_observation_does_not_cut_over(self):
        (self.root / "idle-observation.json").unlink()
        self.deploy()
        self.assertTrue(all(self.running.values()))
        self.assertTrue((self.root / "pending.json").exists())

    def test_all_hosts_stopped_before_any_activation_and_all_activated_before_start(self):
        self.deploy()
        ops = [operation for _, operation in self.operations]
        self.assertLess(max(i for i, op in enumerate(ops) if op == "stop"), ops.index("activate"))
        self.assertLess(max(i for i, op in enumerate(ops) if op == "activate"), ops.index("start"))
        self.assertEqual(set(self.installed.values()), {self.target})
        self.assertFalse((self.root / "pending.json").exists())
        self.assertEqual(json.loads((self.root / "last-deployment.json").read_text())["phase"], "complete")

    def test_new_queued_work_after_stop_preserves_old_binaries(self):
        self.fail = ("ubuntu", "stopped-check")
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertEqual(set(self.installed.values()), {self.old})
        self.assertTrue(all(self.running.values()))
        self.assertTrue((self.root / "deployment.json").exists())

    def test_partial_activation_restores_cohort_before_start_and_journal_blocks_retry(self):
        self.fail = ("ubuntu", "activate")
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertTrue(all(self.running.values()))
        self.assertEqual(set(self.installed.values()), {self.old})
        self.operations.clear()
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertEqual(self.operations, [])

    def test_start_failure_never_rolls_back_migratable_binaries(self):
        self.fail = ("ubuntu", "start")
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertEqual(set(self.installed.values()), {self.target})
        self.assertEqual(json.loads((self.root / "deployment.json").read_text())["phase"], "starting")
        self.assertTrue((self.root / "pending.json").exists())

    def test_inventory_changed_after_build_cannot_cut_over(self):
        self.config["hosts"].append({"id": "new-host", "transport": "ssh"})
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertEqual(self.operations, [])

    def test_existing_split_cohort_cannot_cut_over(self):
        self.installed["ubuntu"] = "c" * 40
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertTrue(all(self.running.values()))


class DatabaseGuardTest(unittest.TestCase):
    def test_real_database_detects_queued_work_and_imminent_schedules(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "state.sqlite"
            c = sqlite3.connect(database)
            try:
                for table in ["orchestration_v2_projection_runs", "orchestration_v2_projection_provider_turns"]:
                    c.execute(f"CREATE TABLE {table} (completed_at TEXT)")
                c.executescript("""
                    CREATE TABLE orchestration_v2_effect_outbox (status TEXT);
                    CREATE TABLE orchestration_v2_projection_runtime_requests (resolved_at TEXT, status TEXT);
                    CREATE TABLE scheduled_task_webhook_pending (state TEXT);
                    CREATE TABLE scheduled_tasks (enabled INTEGER, last_run_status TEXT, next_run_at TEXT);
                    INSERT INTO orchestration_v2_projection_runs VALUES (NULL);
                    INSERT INTO orchestration_v2_effect_outbox VALUES ('pending');
                    INSERT INTO scheduled_tasks VALUES (1,'succeeded',datetime('now','+1 minute'));
                """)
                c.commit()
                self.assertEqual(host.database_busy(database), {"runs": 1, "effects": 1, "schedules": 1})
                self.assertEqual(host.database_busy(database, include_schedules=False), {"runs": 1, "effects": 1})
            finally:
                c.close()

    def test_unknown_schema_fails_closed_and_reader_never_changes_data(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "state.sqlite"
            with sqlite3.connect(database) as c:
                c.execute("CREATE TABLE sentinel (value TEXT)")
                c.execute("INSERT INTO sentinel VALUES ('preserve')")
            c.close()
            before = database.read_bytes()
            with self.assertRaises(sqlite3.OperationalError):
                host.database_busy(database)
            self.assertEqual(database.read_bytes(), before)


class LayoutTest(unittest.TestCase):
    def test_worktree_resolves_the_same_canonical_local_state(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            repo, worktree = base / "canonical", base / "feature"
            def git(*args):
                return subprocess.run(["git", *args], check=True, capture_output=True, text=True)
            git("init", "-b", "personal", str(repo))
            git("-C", str(repo), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture")
            git("-C", str(repo), "worktree", "add", "--detach", str(worktree))
            self.assertEqual(layout.shared_root(repo), repo.resolve())
            self.assertEqual(layout.shared_root(worktree), repo.resolve())

    def test_missing_inventory_blocks_release_instead_of_assuming_local_only(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(manage, "LOCAL", Path(directory)):
            with self.assertRaisesRegex(RuntimeError, "Host inventory missing"):
                manage.inventory()


class MacArtifactTest(unittest.TestCase):
    def test_failed_sign_or_verification_never_publishes_a_ready_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / 'repo'
            repo.mkdir()
            (repo / 'package.json').write_text(json.dumps({'engines': {'node': '0'}}))
            project = root / 'project'
            binaries = project / 'tooling/node-v0-darwin-arm64/bin'
            binaries.mkdir(parents=True)
            settings = root / 'settings.json'
            hosts = root / 'hosts.json'
            settings.write_text(json.dumps({'signing_identity': 'fixture', 'bundle_id': 'fixture.personal'}))
            hosts.write_text(json.dumps({'hosts': [{'transport': 'local', 'home': '/fixture/home'}]}))
            script = Path(manage.SCRIPTS) / 'build-mac.sh'
            command = f"""#!{sys.executable}
import hashlib,json,os,plistlib,shutil,sys
from pathlib import Path
name=Path(sys.argv[0]).name
args=sys.argv[1:]
if name=='node':
 if args==['--version']: print('v0')
 elif args[0]=='-p': print('1.0.0')
 else:
  app=Path(args[args.index('--output-dir')+1])/'mac-arm64/T3 Code (Beta).app/Contents'
  (app/'Resources').mkdir(parents=True)
  (app/'Info.plist').write_bytes(plistlib.dumps({{}}))
elif name=='security': print('fixture')
elif name=='ditto': shutil.copytree(args[0],args[1])
elif name=='git': print('lockfile')
elif name=='codesign':
 app=Path(args[-1]); final=Path(os.environ['FIXTURE_TARGET'])
 assert not final.exists(), 'bundle visible before signing completed'
 assert (app/'Contents/Resources/MAINTENANCE_READY').is_file()
 digest=hashlib.sha256((app/'Contents/Info.plist').read_bytes()).hexdigest()
 signature=app/'signature'
 if '--verify' in args:
  assert signature.read_text()==digest
 else: signature.write_text(digest)
 if os.environ['FIXTURE_FAILURE'] == ('verify' if '--verify' in args else 'sign'): sys.exit(1)
"""
            for name in ('node', 'vp', 'security', 'ditto', 'git', 'codesign'):
                path = binaries / name
                path.write_text(command)
                path.chmod(0o755)
            for failure in ('sign', 'verify', 'none'):
                with self.subTest(failure=failure):
                    destination = root / failure
                    destination.mkdir()
                    target = destination / 'T3 Code (Personal).app'
                    env = dict(os.environ, FIXTURE_TARGET=str(target), FIXTURE_FAILURE=failure)
                    result = subprocess.run(['bash', str(script), str(project), str(repo), 'b' * 40,
                                             str(destination), str(settings), str(hosts)], env=env, capture_output=True)
                    self.assertEqual(result.returncode == 0, failure == 'none', result.stderr.decode())
                    self.assertEqual(target.exists(), failure == 'none')
                    self.assertEqual(list(destination.glob('.signing.*')), [])
                    if target.exists():
                        value = plistlib.loads((target / 'Contents/Info.plist').read_bytes())
                        self.assertEqual(value['CFBundleIdentifier'], 'fixture.personal')
                        self.assertEqual(value['LSEnvironment']['ANTHROPIC_API_KEY'], '')


class BuildCohortTest(unittest.TestCase):
    def test_builders_overlap_and_only_a_complete_valid_cohort_replaces_the_queue(self):
        for failure in ('ubuntu', 'evidence', None):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                commit = 'b' * 40
                config = {'origin': 'fixture', 'hosts': [{'id': 'mac'}, {'id': 'ubuntu'}]}
                pending = root / 'pending.json'
                previous = {'commit': 'a' * 40}
                host.atomic_json(pending, previous)
                barrier = threading.Barrier(2, timeout=5)
                finished = []

                def build(h, *_args):
                    barrier.wait()
                    finished.append(h['id'])
                    if h['id'] == failure:
                        raise RuntimeError('fixture build failed')

                def run(*args, **_kwargs):
                    if 'get-url' in args:
                        return 'fixture'
                    if args[-2:] == ('rev-parse', 'HEAD'):
                        return commit
                    return ''

                evidence_checks = []
                def evidence(*_args):
                    evidence_checks.append(True)
                    if len(evidence_checks) > 1 and failure == 'evidence':
                        raise RuntimeError('verification evidence changed during builds')

                with patch.multiple(manage, ROOT=root, LOCAL=root, STATE=root), \
                        patch.object(manage, 'inventory', return_value=config), \
                        patch.object(manage, 'pending_release', return_value=previous), \
                        patch.object(manage, 'run', side_effect=run), \
                        patch.object(manage, 'host_call', side_effect=lambda *_args: {'target_ready': len(finished) == 2}), \
                        patch.object(manage.verification, 'require_commit', side_effect=evidence), \
                        patch.object(manage, 'build_host', side_effect=build):
                    if failure:
                        with self.assertRaisesRegex(RuntimeError, 'ubuntu.*fixture build failed|evidence changed'):
                            manage.stage(commit)
                    else:
                        manage.stage(commit)
                self.assertCountEqual(finished, ['mac', 'ubuntu'])
                self.assertEqual(json.loads(pending.read_text())['commit'], previous['commit'] if failure else commit)
                self.assertEqual((root / 'superseded' / (previous['commit'] + '.json')).exists(), failure is None)


if __name__ == "__main__":
    unittest.main()
