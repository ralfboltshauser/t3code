"""Exercise readiness and integration against disposable real Git repositories."""

import json
import os
import sys
import subprocess
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import workflow
import manage
import host
import verification
from host import atomic_json


class WorkflowTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / 'source'
        self.remote = self.root / 'origin.git'
        self.git(self.root, 'init', '--bare', str(self.remote))
        self.git(self.root, 'init', '-b', 'personal', str(self.repo))
        self.git(self.repo, 'config', 'user.name', 'Fixture')
        self.git(self.repo, 'config', 'user.email', 'fixture@example.invalid')
        self.git(self.repo, 'config', 'commit.gpgsign', 'false')
        self.git(self.repo, 'config', 'tag.gpgsign', 'false')
        (self.repo / '.gitignore').write_text('.t3-fork/\n.env\nnode_modules/\n.astro/\n')
        (self.repo / 'config').mkdir()
        (self.repo / 'config/settings').write_text('fixture')
        (self.repo / 'config-link').symlink_to('config', target_is_directory=True)
        self.git(self.repo, 'add', '.gitignore', 'config', 'config-link')
        initial = self.commit(self.repo, 'base')
        self.git(self.repo, 'update-index', '--add', '--cacheinfo', f'160000,{initial},reference')
        self.git(self.repo, 'commit', '-m', 'fixture submodule')
        (self.repo / 'reference').mkdir()
        self.git(self.repo, 'remote', 'add', 'origin', str(self.remote))
        self.git(self.repo, 'push', 'origin', 'personal')
        self.git(self.repo, 'remote', 'add', 'upstream', str(self.remote))
        self.git(self.repo, 'push', 'origin', 'personal:main')
        self.engine = workflow.Workflow(self.repo)
        self.control = self.root / 'check-mode'
        self.control.write_text('pass')
        binary = self.root / 'bin/vp'
        binary.parent.mkdir()
        binary.write_text(f"""#!{sys.executable}
import os,sys
from pathlib import Path
assert sys.argv[1:3] == ['run', 'check:changed'], sys.argv
mode = Path(os.environ['CHECK_FIXTURE_MODE']).read_text()
print('check fixture: ' + mode, flush=True)
if mode == 'dirty':
 Path('base').write_text('changed')
if mode == 'generated':
 target=Path('.astro/content.d.ts'); state=target.stat(); target.write_bytes(target.read_bytes()); os.utime(target, ns=(state.st_atime_ns,state.st_mtime_ns))
if mode == 'reverted':
 target = Path('base'); value = target.read_bytes(); target.write_bytes(b'changed'); target.write_bytes(value)
sys.exit(1 if mode == 'fail' else 0)
""")
        binary.chmod(0o755)
        environment = patch.dict(os.environ, {'PATH': str(binary.parent) + os.pathsep + os.environ['PATH'],
                                            'CHECK_FIXTURE_MODE': str(self.control)})
        environment.start()
        self.addCleanup(environment.stop)
        probe = patch.object(workflow.Workflow, 'source_probe', lambda engine, feature: dict(head=feature['head'], dirty=False, active=False))
        probe.start()
        self.addCleanup(probe.stop)

    def git(self, cwd, *args):
        return subprocess.check_output(['git', '-C', str(cwd), *args], text=True, stderr=subprocess.PIPE).strip()

    def commit(self, cwd, name):
        (cwd / name).write_text(name)
        self.git(cwd, 'add', name)
        self.git(cwd, 'commit', '-m', name)
        return self.git(cwd, 'rev-parse', 'HEAD')

    def feature(self, name, base='personal', depends=()):
        path = self.root / name
        self.git(self.repo, 'worktree', 'add', '-b', name, str(path), base)
        engine = workflow.Workflow(path)
        engine.register(name, name, list(depends), 'fixture-thread')
        self.commit(path, name)
        engine.ready(name, 'focused behavioral checks passed')
        return path, engine

    def test_ready_is_exact_published_head_and_dirty_or_advanced_work_is_excluded(self):
        path, feature = self.feature('one')
        self.assertEqual(self.engine.collect()['features'][0]['head'], self.git(path, 'rev-parse', 'HEAD'))
        self.assertEqual(feature.ready('one', 'repeat checks')['head'], self.git(path, 'rev-parse', 'HEAD'))
        (path / 'untracked').write_text('unfinished')
        with self.assertRaisesRegex(RuntimeError, 'uncommitted'):
            feature.ready('one', 'checks')
        (path / 'untracked').unlink()
        self.commit(path, 'later')
        self.git(path, 'push', 'origin', 'one')
        result = self.engine.collect()
        self.assertEqual(result['features'], [])
        self.assertIn('advanced', result['excluded'][0]['reason'])

    def test_independent_clone_discovers_readiness_and_snapshot_does_not_grow(self):
        self.feature('one')
        clone = self.root / 'other'
        self.git(self.root, 'clone', '-b', 'personal', str(self.remote), str(clone))
        other = workflow.Workflow(clone)
        self.assertEqual(other.collect()['features'][0]['id'], 'one')
        snapshot = self.engine.freeze('batch')
        self.feature('two')
        self.assertEqual([f['id'] for f in self.engine.read_release('batch')['features']], ['one'])
        self.assertEqual(snapshot['personal'], self.git(self.repo, 'rev-parse', 'origin/personal'))

    def test_dependencies_are_ordered_and_missing_dependencies_defer_dependents(self):
        self.feature('parent')
        self.feature('child', base='parent', depends=['parent'])
        result = self.engine.collect()
        self.assertEqual([f['id'] for f in result['features']], ['parent', 'child'])
        self.engine.withdraw('parent')
        result = self.engine.collect()
        self.assertEqual(result['features'], [])
        self.assertTrue(any('dependency' in f['reason'] for f in result['excluded']))

    def test_integration_is_resumable_and_verification_requires_both_parents(self):
        self.feature('one')
        self.engine.freeze('batch')
        candidate = Path(self.engine.integrate('batch')['candidate'])
        self.assertEqual(self.engine.integrate('batch')['candidate'], str(candidate))
        release = self.engine.verify('batch', 'combined checks passed')
        self.assertTrue(self.engine.ancestor(release['features'][0]['head'], release['commit']))
        self.assertEqual(self.engine.publish('batch')['phase'], 'published')
        self.assertEqual(self.git(self.repo, 'ls-remote', 'origin', 'refs/heads/personal').split()[0], release['commit'])
        self.commit(candidate, 'after-checks')
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            self.engine.publish('batch')

    def test_verification_requires_completed_checks_and_revokes_previous_success(self):
        self.engine.freeze('batch')
        self.engine.integrate('batch')
        release = self.engine.verify('batch', 'semantic checks passed')
        self.assertEqual(release['verification']['exit_code'], 0)
        self.assertEqual(release['verification']['status'], 'completed')
        generated = Path(release['candidate']) / '.astro/content.d.ts'
        generated.parent.mkdir()
        generated.write_text('generated fixture')
        self.control.write_text('generated')
        self.engine.verify('batch', 'cached generator restores identical bytes')
        self.control.write_text('pass')
        with verification.candidate_lock(release['candidate']):
            with self.assertRaisesRegex(RuntimeError, 'already running'):
                self.engine.verify('batch', 'checks')
        with patch.object(verification, 'run_check', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.engine.verify('batch', 'checks')
        with self.assertRaisesRegex(RuntimeError, '[Vv]erif'):
            self.engine.publish('batch')
        self.engine.verify('batch', 'checks')
        self.control.write_text('fail')
        with self.assertRaisesRegex(RuntimeError, 'checks failed'):
            self.engine.verify('batch', 'a PASS claim cannot override the exit status')
        with self.assertRaisesRegex(RuntimeError, '[Vv]erif'):
            self.engine.publish('batch')

    def test_verification_rejects_mixed_source_and_stale_or_missing_evidence(self):
        self.engine.freeze('batch')
        candidate = Path(self.engine.integrate('batch')['candidate'])
        for mode in ('dirty', 'reverted'):
            with self.subTest(mode=mode):
                self.control.write_text(mode)
                with self.assertRaisesRegex(RuntimeError, 'inputs changed'):
                    self.engine.verify('batch', 'checks')
                self.git(candidate, 'checkout', '--', 'base')
        self.control.write_text('pass')
        release = self.engine.verify('batch', 'checks')
        receipt = Path(release['verification']['receipt'])
        saved = receipt.read_text()
        legacy = dict(release)
        legacy.pop('verification')
        atomic_json(self.engine.release_path('aaa-legacy'), legacy)
        verification.require_commit(self.engine.state, release['commit'])
        receipt.unlink()
        with self.assertRaisesRegex(RuntimeError, 'evidence'):
            verification.require_commit(self.engine.state, release['commit'])
        with self.assertRaisesRegex(RuntimeError, 'evidence'):
            self.engine.publish('batch')
        receipt.write_text(saved)
        log = Path(release['verification']['log'])
        original = log.read_bytes()
        log.write_bytes(b'changed log')
        with self.assertRaisesRegex(RuntimeError, 'evidence'):
            self.engine.publish('batch')
        log.write_bytes(original)
        with patch.dict(os.environ, {'T3CODE_THREAD_ID': 'different-caller'}):
            verification.validate(release)
        with patch.dict(os.environ, {'NODE_OPTIONS': '--no-warnings'}):
            with self.assertRaisesRegex(RuntimeError, 'inputs changed'):
                self.engine.publish('batch')
        (candidate / '.env').write_text('CHANGED=1')
        with self.assertRaisesRegex(RuntimeError, 'uncommitted|inputs changed'):
            self.engine.publish('batch')

    def test_withdrawal_and_duplicate_identity_are_explicit(self):
        self.feature('one')
        self.engine.withdraw('one')
        self.assertEqual(self.engine.collect()['features'], [])
        with self.assertRaisesRegex(RuntimeError, 'exists'):
            self.engine.register('one', 'different', [], 'other')

    def test_release_refuses_concurrent_personal_advance(self):
        self.feature('one')
        self.engine.freeze('batch')
        self.engine.integrate('batch')
        self.engine.verify('batch', 'checks')
        self.commit(self.repo, 'concurrent')
        self.git(self.repo, 'push', 'origin', 'personal')
        with self.assertRaisesRegex(RuntimeError, 'personal advanced'):
            self.engine.publish('batch')

    def test_workspace_probe_reads_shared_chat_activity_without_modifying_state(self):
        path, _ = self.feature('one')
        home = self.root / 'runtime'
        database = home / 'userdata/statev2.sqlite'
        database.parent.mkdir(parents=True)
        with sqlite3.connect(database) as connection:
            connection.executescript("CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, payload_json TEXT, deleted_at TEXT); CREATE TABLE orchestration_v2_projection_runs (thread_id TEXT, completed_at TEXT);")
            connection.execute("INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, NULL)", ('side-chat', json.dumps({'worktreePath': str(path)})))
            connection.execute("INSERT INTO orchestration_v2_projection_runs VALUES ('side-chat', NULL)")
        before = database.read_bytes()
        with patch.object(host, 'runtime', return_value=(None, None, {})):
            value = host.workspace_probe({'home': str(home)}, str(path), str(self.repo))
        self.assertTrue(value['referenced'])
        self.assertEqual(value['active'], 1)
        self.assertFalse(value['dirty'])
        self.assertEqual(database.read_bytes(), before)

    def test_pending_replacement_requires_ancestry_and_no_cutover(self):
        state = self.root / 'state'
        old = self.git(self.repo, 'rev-parse', 'HEAD')
        new = self.commit(self.repo, 'newer')
        atomic_json(state / 'pending.json', {'commit': old})
        with patch.object(manage, 'ROOT', self.repo), patch.object(manage, 'STATE', state):
            self.assertEqual(manage.pending_release(new)['commit'], old)
            atomic_json(state / 'pending.json', {'commit': new})
            with self.assertRaisesRegex(RuntimeError, 'ancestor'):
                manage.pending_release(old)
            atomic_json(state / 'deployment.json', {'phase': 'starting'})
            with self.assertRaisesRegex(RuntimeError, 'journal'):
                manage.pending_release(new)

    def test_active_source_and_dependency_cycles_are_excluded(self):
        self.feature('one', depends=['two'])
        self.feature('two', depends=['one'])
        result = self.engine.collect()
        self.assertEqual(result['features'], [])
        self.assertTrue(any('cycle' in item['reason'] for item in result['excluded']))
        with patch.object(workflow.Workflow, 'source_probe', return_value=dict(head='unknown', dirty=False, active=True)):
            result = self.engine.collect()
        self.assertEqual(result['features'], [])
        self.assertTrue(any('active' in item['reason'] for item in result['excluded']))

    def test_cleanup_preserves_owned_sources_then_removes_exact_orphan_refs(self):
        path, _ = self.feature('one')
        head = self.git(path, 'rev-parse', 'HEAD')
        self.git(self.repo, 'merge', '--no-edit', head)
        release = self.git(self.repo, 'rev-parse', 'HEAD')
        owned = dict(referenced=True, active=False, exists=True, head=head, dirty=False, running=False, processes=False)
        with patch.object(host, 'workspace_probe', return_value=owned):
            with self.assertRaisesRegex(RuntimeError, 'owns'):
                host.cleanup_workspace({}, str(path), str(self.repo), 'one', head, release)
        self.assertTrue(path.exists())
        owned['referenced'] = False
        with patch.object(host, 'workspace_probe', return_value=owned):
            self.assertEqual(host.cleanup_workspace({}, str(path), str(self.repo), 'one', head, release)['outcome'], 'removed')
        self.assertFalse(path.exists())
        self.assertEqual(self.git(self.repo, 'ls-remote', '--refs', 'origin', 'refs/heads/one'), '')
        self.assertTrue(self.engine.ancestor(head, release))

    def test_cleanup_never_deletes_a_newer_branch_or_busy_workspace(self):
        path, _ = self.feature('one')
        head = self.git(path, 'rev-parse', 'HEAD')
        self.git(self.repo, 'merge', '--no-edit', head)
        release = self.git(self.repo, 'rev-parse', 'HEAD')
        probe = dict(referenced=False, active=False, exists=True, head=head, dirty=False, running=True, processes=False)
        with patch.object(host, 'workspace_probe', return_value=probe):
            with self.assertRaisesRegex(RuntimeError, 'runtime'):
                host.cleanup_workspace({}, str(path), str(self.repo), 'one', head, release)
        newer = self.commit(path, 'newer')
        self.git(path, 'push', 'origin', 'one')
        with self.assertRaisesRegex(RuntimeError, 'advanced'):
            host.cleanup_workspace({}, str(path), str(self.repo), 'one', head, release)
        self.assertEqual(self.git(path, 'rev-parse', 'HEAD'), newer)

    def test_cleanup_never_touches_active_or_unverified_sources(self):
        self.feature('one')
        self.engine.freeze('batch')
        with self.assertRaisesRegex(RuntimeError, 'deployment'):
            self.engine.cleanup('batch')


if __name__ == '__main__':
    unittest.main()
