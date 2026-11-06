"""Exercise readiness and integration against disposable real Git repositories."""

import json
import subprocess
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import workflow
import manage
import host
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
        self.commit(self.repo, 'base')
        self.git(self.repo, 'remote', 'add', 'origin', str(self.remote))
        self.git(self.repo, 'push', 'origin', 'personal')
        self.git(self.repo, 'remote', 'add', 'upstream', str(self.remote))
        self.git(self.repo, 'push', 'origin', 'personal:main')
        self.engine = workflow.Workflow(self.repo)
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
