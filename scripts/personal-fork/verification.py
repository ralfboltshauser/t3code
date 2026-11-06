"""Completed release checks tied to candidate inputs, never to a textual PASS claim."""

import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import time
import uuid

from host import atomic_json


def git(candidate, *args):
    return subprocess.check_output(['git', '-C', str(candidate), *args]).decode().removesuffix('\n')


@contextlib.contextmanager
def candidate_lock(candidate):
    path = Path(git(candidate, 'rev-parse', '--path-format=absolute', '--git-path', 'release-verification.lock'))
    with path.open('a') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Release verification is already running for this candidate') from error
        yield stream.fileno()


def inputs(candidate):
    candidate = Path(candidate)
    if git(candidate, 'status', '--porcelain', '--untracked-files=all'):
        raise RuntimeError('Verification inputs changed: candidate has uncommitted or untracked work')
    digest = hashlib.sha256()
    digest.update(git(candidate, 'rev-parse', 'HEAD').encode())
    entries = [entry.split('\t', 1) for entry in git(candidate, 'ls-files', '--stage', '-z').split('\0') if entry]
    tracked = [name for _, name in entries]
    tracked_set = set(tracked)
    submodules = {name for metadata, name in entries if metadata.startswith('160000 ')}
    ignored = git(candidate, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--',
                  ':(glob)**/.env*', ':(glob)**/.generated/**', ':(glob)**/.astro/**',
                  ':(glob)**/*.d.ts', ':(exclude,glob)**/node_modules/**').split('\0')
    for relative in sorted(set(tracked + ignored + ['node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml'])):
        if not relative:
            continue
        path = candidate / relative
        digest.update(relative.encode() + b'\0')
        if path.is_symlink():
            stat = path.lstat()
            digest.update(f'{stat.st_mtime_ns}:{stat.st_ctime_ns}:{stat.st_mode}'.encode())
            digest.update(os.readlink(path).encode())
            if path.is_dir() and not path.resolve().is_relative_to(candidate.resolve()):
                raise RuntimeError(f'Unsupported external verification directory: {relative}')
        if path.is_file():
            stat = path.stat()
            # Times also detect an edit restored to its original bytes while checks ran.
            if relative not in tracked_set and '/.astro/' in '/' + relative:
                # Task-cache restoration changes metadata on these generated outputs without changing inputs.
                digest.update(str(stat.st_mode).encode())
            else:
                digest.update(f'{stat.st_mtime_ns}:{stat.st_ctime_ns}:{stat.st_mode}'.encode())
            digest.update(path.read_bytes())
        elif relative in submodules:
            if (path / '.git').exists():
                digest.update(inputs(path).encode())
            elif path.exists() and any(path.iterdir()):
                raise RuntimeError(f'Uninitialized verification submodule has contents: {relative}')
        elif path.exists() and not path.is_symlink():
            raise RuntimeError(f'Unsupported verification input: {relative}')
    caller_identity = {'T3CODE_THREAD_ID', 'T3CODE_RUN_ID', 'T3CODE_TURN_ID'}
    environment = {key: value for key, value in os.environ.items()
                   if key not in caller_identity and
                   (key in ('PATH', 'CI', 'TMPDIR', 'TEMP', 'TMP', 'TZ', 'LANG', 'LC_ALL')
                    or key.startswith(('NODE_', 'T3', 'VITE_', 'VP_', 'CHECK_CHANGED_')))}
    digest.update(json.dumps(environment, sort_keys=True).encode())
    digest.update(f'{platform.system()}:{platform.machine()}'.encode())
    for executable in ('node', 'vp', 'git'):
        resolved = shutil.which(executable)
        if not resolved:
            raise RuntimeError(f'Verification requires {executable} on PATH')
        path = Path(resolved).resolve()
        stat = path.stat()
        digest.update(f'{path}:{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}'.encode())
    return digest.hexdigest()


def run_check(command, candidate, log, lock_fd):
    with log.open('wb') as output:
        with subprocess.Popen(command, cwd=candidate, stdout=output, stderr=subprocess.STDOUT,
                              start_new_session=True, pass_fds=(lock_fd,)) as child:
            try:
                return child.wait()
            except BaseException:
                if child.poll() is None:
                    try:
                        os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    child.wait()
                raise


def check(candidate, base, directory, now, lock_fd):
    directory.mkdir(parents=True, exist_ok=True)
    receipt = directory / f'{uuid.uuid4().hex}.json'
    log = receipt.with_suffix('.log')
    command = ['vp', 'run', 'check:changed', base, '--fresh']
    before = inputs(candidate)
    result = dict(version=1, status='running', candidate=str(candidate),
                  commit=git(candidate, 'rev-parse', 'HEAD'), base=base, inputs=before,
                  command=command, started_at=now(), receipt=str(receipt), log=str(log))
    atomic_json(receipt, result)
    started = time.monotonic()
    print(f'Running release checks; log: {log}', flush=True)
    try:
        result['exit_code'] = run_check(command, candidate, log, lock_fd)
        if result['exit_code'] != 0:
            raise RuntimeError(f'Release checks failed (exit {result["exit_code"]}); inspect {log}')
        if inputs(candidate) != before:
            raise RuntimeError('Verification inputs changed while checks ran; rerun on the settled candidate')
        result.update(status='completed', log_sha256=hashlib.sha256(log.read_bytes()).hexdigest())
    except BaseException as error:
        result.update(status='failed', error=str(error))
        raise
    finally:
        result.update(finished_at=now(), duration_seconds=round(time.monotonic() - started, 3))
        atomic_json(receipt, result)
    return result


def validate(release):
    evidence = release.get('verification', {})
    try:
        saved = json.loads(Path(evidence['receipt']).read_text())
        if saved != evidence or saved['version'] != 1 or saved['status'] != 'completed' or saved['exit_code'] != 0:
            raise ValueError('Incomplete verification')
        if saved['commit'] != release['commit'] or saved['base'] != release['personal']:
            raise ValueError('Stale verification')
        if saved['command'] != ['vp', 'run', 'check:changed', release['personal'], '--fresh']:
            raise ValueError('Unexpected verification command')
        if saved['candidate'] != release['candidate'] or not saved['finished_at']:
            raise ValueError('Wrong verification candidate')
        if hashlib.sha256(Path(saved['log']).read_bytes()).hexdigest() != saved['log_sha256']:
            raise ValueError('Verification log changed')
    except (OSError, KeyError, ValueError, TypeError) as error:
        raise RuntimeError('Completed verification evidence is missing or invalid; run workflow verify') from error
    if inputs(release['candidate']) != evidence['inputs']:
        raise RuntimeError('Verification inputs changed; run workflow verify again')


def require_commit(state, commit):
    failures = []
    for path in sorted((state / 'releases').glob('*.json')):
        release = json.loads(path.read_text())
        if release.get('commit') == commit and release.get('phase') in ('verified', 'published', 'staged', 'deployed'):
            try:
                validate(release)
                return
            except RuntimeError as error:
                failures.append(f'{path.name}: {error}')
    detail = '; '.join(failures) or 'no completed release record'
    raise RuntimeError('Completed release verification evidence is required before staging: ' + detail)
