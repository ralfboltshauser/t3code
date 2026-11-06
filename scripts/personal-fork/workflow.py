#!/usr/bin/env python3
"""Pin ready features in Git; integrate and report deliberate, resumable releases."""

import argparse
import contextlib
import fcntl
import json
from pathlib import Path
import re
import socket
import subprocess
import sys

from host import atomic_json
from layout import shared_root
from manage import now

MARKERS = 'refs/tags/t3-ready/'
FETCHED = 'refs/t3-fork/ready/'


class Workflow:
    def __init__(self, checkout):
        self.checkout = Path(checkout).resolve()
        self.root = shared_root(self.checkout)
        self.state = self.root / '.t3-fork/state'

    def git(self, *args, cwd=None, input=None):
        return subprocess.check_output(['git', '-C', str(cwd or self.root), *args],
                                       input=input, text=True, stderr=subprocess.PIPE).strip()

    @contextlib.contextmanager
    def lock(self):
        self.state.mkdir(parents=True, exist_ok=True)
        with (self.state / 'workflow.lock').open('a') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield

    def name(self, value):
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', value):
            raise ValueError('Use a lowercase ID containing letters, digits and hyphens (max 80).')
        return value

    def sha(self, ref, cwd=None):
        return self.git('rev-parse', '--verify', f'{ref}^{{commit}}', cwd=cwd)

    def ancestor(self, base, head):
        result = subprocess.run(['git', '-C', str(self.root), 'merge-base', '--is-ancestor', base, head],
                                capture_output=True)
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr.decode())
        return result.returncode == 0

    def clean(self, path):
        if self.git('status', '--porcelain', '--untracked-files=all', cwd=path):
            raise RuntimeError(f'{path} has uncommitted or untracked work')

    def feature_path(self, identity):
        return self.state / 'features' / f'{self.name(identity)}.json'

    def release_path(self, identity):
        return self.state / 'releases' / f'{self.name(identity)}.json'

    def register(self, identity, summary, depends, thread):
        with self.lock():
            target = self.feature_path(identity)
            if target.exists():
                raise RuntimeError(f'Feature {identity} already exists; inspect its record instead')
            if self.checkout == self.root:
                raise RuntimeError('Feature work must use a separate worktree, never the canonical checkout')
            branch = self.git('symbolic-ref', '--short', 'HEAD', cwd=self.checkout)
            if branch in ('personal', 'main'):
                raise RuntimeError('Use a feature branch')
            self.git('fetch', '--no-tags', 'origin', 'personal')
            base = self.sha('origin/personal')
            if not self.ancestor(base, self.sha('HEAD', self.checkout)):
                parents = [json.loads(self.feature_path(d).read_text()) for d in depends]
                if not parents or not all(self.ancestor(p['base'], self.sha('HEAD', self.checkout)) for p in parents):
                    raise RuntimeError('Worktree does not contain current personal; use an explicit registered dependency for a stack')
            value = dict(version=1, id=self.name(identity), summary=summary, branch=branch,
                         base=base, depends=[self.name(d) for d in depends], thread=thread,
                         source=dict(host=socket.gethostname(), root=str(self.root), worktree=str(self.checkout)),
                         phase='working', registered_at=now())
            if identity in depends:
                raise RuntimeError('A feature cannot depend on itself')
            atomic_json(target, value)
            return value

    def ready(self, identity, checks):
        with self.lock():
            path = self.feature_path(identity)
            feature = json.loads(path.read_text())
            workspace = Path(feature['source']['worktree'])
            if workspace != self.checkout:
                raise RuntimeError('Mark ready from the registered feature worktree')
            self.clean(workspace)
            if self.git('symbolic-ref', '--short', 'HEAD', cwd=workspace) != feature['branch']:
                raise RuntimeError('Feature branch changed')
            if not checks.strip():
                raise RuntimeError('Record the actual verification commands/results')
            feature.update(head=self.sha('HEAD', workspace), checks=checks, phase='ready', ready_at=now())
            self.git('push', 'origin', f"refs/heads/{feature['branch']}:refs/heads/{feature['branch']}")
            tag = f"{MARKERS}{identity}/{feature['head']}"
            existing = self.git('ls-remote', '--refs', 'origin', tag)
            if existing:
                self.git('fetch', '--no-tags', 'origin', tag)
                saved = json.loads(self.git('cat-file', 'tag', existing.split()[0]).split('\n\n', 1)[1])
                if any(saved.get(key) != feature[key] for key in ('id', 'head', 'branch', 'source')):
                    raise RuntimeError('Readiness identity is already owned by another source')
                atomic_json(path, saved)
                return saved
            message = json.dumps(feature, sort_keys=True) + '\n'
            # A full ref, not the local tag namespace, avoids inherited signing helpers for operational metadata.
            tag_object = self.git('mktag', input=f"object {feature['head']}\ntype commit\ntag t3-ready/{identity}/{feature['head']}\ntagger T3 fork <maintenance@localhost> 0 +0000\n\n{message}")
            self.git('push', 'origin', f'{tag_object}:{tag}')
            atomic_json(path, feature)
            return feature

    def withdraw(self, identity):
        with self.lock():
            self.name(identity)
            refs = self.git('ls-remote', '--refs', 'origin', f'{MARKERS}{identity}/*').splitlines()
            for line in refs:
                oid, ref = line.split()
                self.git('push', f'--force-with-lease={ref}:{oid}', 'origin', f':{ref}')
            path = self.feature_path(identity)
            if path.exists():
                value = json.loads(path.read_text())
                value['phase'] = 'working'
                atomic_json(path, value)
            return {'withdrawn': identity}

    def fetch(self):
        self.git('fetch', '--no-tags', '--prune', 'origin',
                 '+refs/heads/*:refs/remotes/origin/*', f'+{MARKERS}*:{FETCHED}*')

    def source_call(self, feature, operation, *args):
        from manage import host_call, inventory
        config = inventory()
        source = feature['source']
        for host in config['hosts']:
            same = (host['transport'] == 'local' and source['host'] == socket.gethostname()) or (
                host['transport'] == 'ssh' and host.get('repo') == source['root'])
            if same:
                return host_call(host, operation, source['worktree'], source['root'], *args)
        raise RuntimeError('Source host is not in the configured inventory; verify/register it before release')

    def source_probe(self, feature):
        return self.source_call(feature, 'workspace-probe')

    def collect(self):
        self.fetch()
        personal = self.sha('origin/personal')
        features, excluded, candidates, included = [], [], {}, set()
        for ref in self.git('for-each-ref', '--format=%(refname)', FETCHED).splitlines():
            try:
                raw = self.git('cat-file', 'tag', ref)
                value = json.loads(raw.split('\n\n', 1)[1])
                identity = self.name(value['id'])
                if value.get('version') != 1 or value.get('phase') != 'ready' or not value.get('checks') or not isinstance(value.get('depends'), list):
                    raise RuntimeError('Invalid readiness metadata')
                for dependency in value['depends']:
                    self.name(dependency)
                if ref != f"{FETCHED}{identity}/{value['head']}" or self.sha(ref) != value['head']:
                    raise RuntimeError('Readiness marker does not match its commit')
                branch = value['branch']
                self.git('check-ref-format', f'refs/heads/{branch}')
                if self.ancestor(value['head'], personal):
                    included.add(identity)
                    continue
                if self.sha(f'refs/remotes/origin/{branch}') != value['head']:
                    raise RuntimeError('Feature branch advanced or changed since readiness')
                source = value['source']
                if source['host'] == socket.gethostname() and Path(source['root']).resolve() == self.root:
                    self.clean(source['worktree'])
                    if self.sha('HEAD', source['worktree']) != value['head']:
                        raise RuntimeError('Feature worktree advanced since readiness')
                probe = self.source_probe(value)
                if probe['dirty'] or probe['head'] != value['head'] or probe['active']:
                    raise RuntimeError('Source workspace is dirty, advanced or still active')
                previous = candidates.get(identity)
                if previous and previous['head'] != value['head']:
                    raise RuntimeError('Multiple ready heads for feature identity')
                candidates[identity] = value
            except (RuntimeError, ValueError, KeyError, subprocess.CalledProcessError) as error:
                excluded.append({'marker': ref, 'reason': str(error)})
        visiting, done, failures = set(), set(), {}

        def visit(identity):
            if identity in done or identity in included:
                return
            if identity in visiting:
                raise RuntimeError(f'dependency cycle at {identity}')
            if identity not in candidates:
                path = self.feature_path(identity)
                known = json.loads(path.read_text()) if path.exists() else None
                if known and known.get('head') and self.ancestor(known['head'], personal):
                    return
                raise RuntimeError(f'dependency {identity} is not ready or included')
            visiting.add(identity)
            try:
                for dependency in candidates[identity]['depends']:
                    visit(dependency)
                done.add(identity)
                features.append(candidates[identity])
            finally:
                visiting.remove(identity)

        for identity in sorted(candidates):
            try:
                visit(identity)
            except RuntimeError as error:
                failures[identity] = str(error)
        excluded.extend({'id': key, 'reason': value} for key, value in failures.items())
        known_paths = {f['source']['worktree'] for f in features}
        for record in self.git('worktree', 'list', '--porcelain').split('\n\n'):
            fields = dict(line.split(' ', 1) for line in record.splitlines() if ' ' in line)
            path = fields.get('worktree')
            branch = fields.get('branch', '').removeprefix('refs/heads/')
            if path and Path(path).resolve() != self.root and path not in known_paths and not branch.startswith('personal-release-'):
                excluded.append(dict(id=branch or path, reason='Worktree has no eligible ready marker; retained', worktree=path))
        return dict(personal=personal, features=features, excluded=excluded)

    def freeze(self, identity):
        with self.lock():
            path = self.release_path(identity)
            if path.exists():
                raise RuntimeError('Release already exists; resume it instead')
            if (self.state / 'deployment.json').exists():
                raise RuntimeError('Resolve incomplete deployment before creating a release')
            self.git('fetch', '--no-tags', 'upstream', 'main')
            release = self.collect()
            release.update(id=self.name(identity), upstream=self.sha('upstream/main'), phase='frozen', created_at=now())
            atomic_json(path, release)
            return release

    def read_release(self, identity):
        return json.loads(self.release_path(identity).read_text())

    def save(self, release):
        atomic_json(self.release_path(release['id']), release)
        return release

    def integrate(self, identity):
        with self.lock():
            release = self.read_release(identity)
            candidate = Path(release.get('candidate', self.root.parent / f"{self.root.name}-release-{identity}"))
            if 'candidate' not in release:
                if candidate.exists():
                    raise RuntimeError('Candidate path already exists; preserve and inspect it')
                release.update(candidate=str(candidate), phase='integrating')
                self.save(release)
            if not candidate.exists():
                self.git('worktree', 'add', '-b', f'personal-release-{identity}', str(candidate), release['personal'])
            self.clean(candidate)
            if release['phase'] in ('verified', 'published', 'staged', 'deployed'):
                if self.sha('HEAD', candidate) != release.get('commit'):
                    raise RuntimeError('Candidate changed; inspect and verify it again')
                return release
            for feature in [*release['features'], {'head': release['upstream']}]:
                if not self.ancestor(feature['head'], self.sha('HEAD', candidate)):
                    self.git('merge', '--no-edit', feature['head'], cwd=candidate)
            release.update(phase='integrated')
            return self.save(release)

    def verify(self, identity, checks):
        with self.lock():
            release = self.read_release(identity)
            self.clean(release['candidate'])
            commit = self.sha('HEAD', release['candidate'])
            for parent in [release['personal'], release['upstream'], *(f['head'] for f in release['features'])]:
                if not self.ancestor(parent, commit):
                    raise RuntimeError('Candidate omits a frozen input')
            if not checks.strip():
                raise RuntimeError('Actual combined check results are required')
            release.update(commit=commit, checks=checks, phase='verified')
            return self.save(release)

    def publish(self, identity):
        with self.lock():
            release = self.read_release(identity)
            if release['phase'] not in ('verified', 'published', 'staged'):
                raise RuntimeError('Verify the combined candidate before publication')
            self.clean(release['candidate'])
            if self.sha('HEAD', release['candidate']) != release['commit']:
                raise RuntimeError('Candidate changed after verification')
            self.git('fetch', '--no-tags', 'origin', 'personal')
            if not self.ancestor(self.sha('origin/personal'), release['commit']):
                raise RuntimeError('personal advanced; merge it into the candidate and verify again')
            self.git('push', 'origin', f"{release['commit']}:refs/heads/personal")
            self.git('update-ref', f"refs/t3-fork/releases/{identity}", release['commit'])
            release['phase'] = 'published'
            return self.save(release)

    def stage(self, identity):
        from manage import stage
        release = self.read_release(identity)
        if release['phase'] not in ('published', 'staged'):
            raise RuntimeError('Publish the verified release first')
        stage(release['commit'])
        from manage import inventory
        with self.lock():
            release = self.read_release(identity)
            release['staged_hosts'] = [host['id'] for host in inventory()['hosts']]
            release['phase'] = 'staged'
            return self.save(release)

    def cleanup(self, identity):
        from manage import host_call, inventory
        with self.lock():
            release = self.read_release(identity)
            commit = release.get('commit')
            if not commit or release['phase'] not in ('staged', 'deployed'):
                raise RuntimeError('Verified all-host deployment is required before cleanup')
            if (self.state / 'deployment.json').exists():
                raise RuntimeError('Resolve incomplete deployment before cleanup')
            self.fetch()
            config = inventory()
            observed = [host_call(host, 'probe') for host in config['hosts']]
            installed = {h['installed'] for h in observed}
            if len(installed) != 1 or any(not h['running'] for h in observed) or not self.ancestor(commit, next(iter(installed))):
                raise RuntimeError('Verified all-host deployment is required before cleanup')
            release.update(phase='deployed', hosts=observed)
            self.save(release)
            self.fetch()
            outcomes = []
            for feature in release['features']:
                outcome = dict(id=feature['id'], branch=feature['branch'], worktree=feature['source']['worktree'], outcome='retained')
                try:
                    if not self.ancestor(feature['head'], commit):
                        raise RuntimeError('Frozen feature is not included')
                    release['cleanup_in_progress'] = feature['id']
                    self.save(release)
                    self.source_call(feature, 'workspace-cleanup', feature['branch'], feature['head'], commit)
                    outcome['outcome'] = 'removed'
                except (RuntimeError, subprocess.CalledProcessError) as error:
                    outcome['reason'] = str(error)
                outcomes.append(outcome)
                release['cleanup'] = outcomes
                release.pop('cleanup_in_progress', None)
                self.save(release)
            release['cleanup'] = outcomes
            candidate = release.get('candidate')
            if candidate and Path(candidate).exists():
                try:
                    self.source_call(dict(source=dict(host=socket.gethostname(), root=str(self.root), worktree=candidate)),
                                     'workspace-cleanup', f'personal-release-{identity}', commit, commit)
                    release['candidate_cleanup'] = 'removed'
                except (RuntimeError, subprocess.CalledProcessError) as error:
                    release['candidate_cleanup'] = str(error)
            return self.save(release)

    def finalize(self):
        results = []
        for path in sorted((self.state / 'releases').glob('*.json')):
            release = json.loads(path.read_text())
            if release['phase'] not in ('staged', 'deployed'):
                continue
            try:
                self.cleanup(release['id'])
                self.report(release['id'])
                results.append(dict(id=release['id'], state='inspected'))
            except (RuntimeError, subprocess.CalledProcessError) as error:
                results.append(dict(id=release['id'], state='deferred', reason=str(error)))
        return results

    def report(self, identity):
        release = self.read_release(identity)
        lines = [f"# Release {identity}", '', f"State: {release['phase']}",
                 f"Source: {release.get('commit', 'not yet verified')}",
                 f"Upstream: {release['upstream']}", '', '## Included features']
        lines += [f"- {f['summary']} (`{f['id']}`, `{f['head'][:12]}`)" for f in release['features']] or ['- No new ready features.']
        upstream = self.git('log', '--no-merges', '--format=- %h %s', f"{release['personal']}..{release['upstream']}").splitlines()
        lines += ['', '## Upstream updates', *upstream[:25]]
        if len(upstream) > 25:
            lines.append(f'- Plus {len(upstream) - 25} more upstream commits.')
        if not upstream:
            lines.append('- No new upstream commits.')
        lines += ['', '## Excluded or deferred']
        lines += [f"- {f.get('id', f.get('marker'))}: {f['reason']}" for f in release['excluded']] or ['- None.']
        lines += ['', '## Verification', release.get('checks', 'Combined verification pending.'), '', '## Installation']
        lines += [f"- {h['id']}: running {h['installed']}" for h in release.get('hosts', [])]
        if not release.get('hosts'):
            lines += [f'- {host}: staged; installation not yet verified.' for host in release.get('staged_hosts', [])] or ['- Not staged.']
        lines += ['', '## Cleanup']
        lines += [f"- {f['branch']}: {f['outcome']}. {f.get('reason', '')}" for f in release.get('cleanup', [])] or ['- Pending verified deployment and workspace retirement.']
        if release.get('candidate_cleanup'):
            lines.append('Integration worktree: ' + release['candidate_cleanup'])
        text = '\n'.join(lines) + '\n'
        path = self.release_path(identity).with_suffix('.md')
        path.write_text(text)
        return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', type=Path, default=Path.cwd())
    commands = parser.add_subparsers(dest='command', required=True)
    register = commands.add_parser('register')
    register.add_argument('id')
    register.add_argument('--summary', required=True)
    register.add_argument('--depends', action='append', default=[])
    register.add_argument('--thread', required=True)
    ready = commands.add_parser('ready')
    ready.add_argument('id')
    ready.add_argument('--checks', required=True)
    commands.add_parser('list')
    commands.add_parser('finalize')
    for command in ('withdraw', 'freeze', 'integrate', 'publish', 'stage', 'cleanup', 'report'):
        commands.add_parser(command).add_argument('id')
    verify = commands.add_parser('verify')
    verify.add_argument('id')
    verify.add_argument('--checks', required=True)
    args = parser.parse_args()
    engine = Workflow(args.checkout)
    values = vars(args).copy()
    values.pop('checkout')
    command = values.pop('command')
    if 'id' in values:
        values['identity'] = values.pop('id')
    result = getattr(engine, 'collect' if command == 'list' else command)(**values)
    print(result if isinstance(result, str) else json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, subprocess.CalledProcessError, OSError) as error:
        print(f'Workflow stopped: {error}', file=sys.stderr)
        sys.exit(1)
