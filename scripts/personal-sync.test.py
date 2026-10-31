"""Exercise remote-history preservation with real local Git repositories."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class PersonalSyncTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "development"
        self.origin = self.root / "origin.git"
        self.upstream = self.root / "upstream.git"
        self.git(self.root, "init", "--bare", str(self.origin))
        self.git(self.root, "init", "--bare", str(self.upstream))
        self.git(self.root, "init", "-b", "personal", str(self.repo))
        self.git(self.repo, "config", "user.name", "Sync test")
        self.git(self.repo, "config", "user.email", "sync@example.invalid")
        scripts = self.repo / "scripts"
        scripts.mkdir()
        shutil.copy(Path(__file__).with_name("personal-sync.sh"), scripts)
        (scripts / "personal-sync.test.py").write_text("raise SystemExit(0)\n")
        (self.repo / "feature.txt").write_text("personal behavior\n")
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "-m", "baseline")
        self.upstream_base = self.git(self.repo, "rev-parse", "HEAD").strip()
        self.git(self.repo, "remote", "add", "origin", "https://github.com/ralfboltshauser/t3code.git")
        self.git(self.repo, "remote", "add", "upstream", "https://github.com/pingdotgg/t3code.git")
        for name, path in (("origin", self.origin), ("upstream", self.upstream)):
            url = self.git(self.repo, "config", "--get", f"remote.{name}.url").strip()
            self.git(self.repo, "config", f"url.{path}.insteadOf", url)
        self.git(self.repo, "push", "origin", "HEAD:personal", "HEAD:main")
        self.git(self.repo, "push", "upstream", "HEAD:main")
        (self.repo / "custom.txt").write_text("intentional customization\n")
        self.git(self.repo, "add", "custom.txt")
        self.git(self.repo, "commit", "-m", "personal customization")
        self.base = self.git(self.repo, "rev-parse", "HEAD").strip()
        self.git(self.repo, "push", "origin", "HEAD:personal")
        self.home = self.root / "home"
        binaries = self.home / ".local/bin"
        binaries.mkdir(parents=True)
        self.executable(binaries / "codex", """#!/bin/bash
set -eu
if [[ $1 == login ]]; then
  echo "${TEST_LOGIN:-Logged in using ChatGPT}"
  exit 0
fi
if [[ ${TEST_SKIP_MERGE:-0} == 1 ]]; then exit 0; fi
git merge --no-edit upstream/main
if [[ ${TEST_BLOCKED:-0} == 1 ]]; then touch .personal-sync-blocked; fi
if [[ -n ${TEST_RACE:-} ]]; then
  git --git-dir="$TEST_ORIGIN" update-ref refs/heads/personal "$TEST_RACE"
fi
""")
        self.executable(binaries / "vp", """#!/bin/bash
if [[ $1 == run && ${TEST_CHECK_FAIL:-0} == 1 ]]; then exit 1; fi
""")
        self.env = dict(os.environ, HOME=str(self.home), TEST_ORIGIN=str(self.origin))
        self.env.pop("XDG_STATE_HOME", None)

    def executable(self, path, content):
        path.write_text(content)
        path.chmod(0o755)

    def git(self, cwd, *args):
        return subprocess.check_output(["git", *args], cwd=cwd, stderr=subprocess.DEVNULL, text=True)

    def advance_upstream(self):
        self.git(self.repo, "switch", "--detach", self.upstream_base)
        (self.repo / "upstream.txt").write_text("upstream improvement\n")
        self.git(self.repo, "add", "upstream.txt")
        self.git(self.repo, "commit", "-m", "upstream improvement")
        self.target = self.git(self.repo, "rev-parse", "HEAD").strip()
        self.git(self.repo, "push", "upstream", "HEAD:main")
        self.git(self.repo, "switch", "--detach", self.base)

    def sync(self, *args, **env):
        return subprocess.run(
            ["bash", "scripts/personal-sync.sh", *args], cwd=self.repo,
            env=dict(self.env, **env), capture_output=True, text=True,
        )

    def personal(self):
        return self.git(self.root, "--git-dir", str(self.origin), "rev-parse", "personal").strip()

    def test_noop_preserves_dirty_development_checkout(self):
        (self.repo / "feature.txt").write_text("unfinished local work\n")
        result = self.sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no agent needed", result.stdout)
        self.assertEqual((self.repo / "feature.txt").read_text(), "unfinished local work\n")
        self.assertEqual(self.personal(), self.base)

    def test_checked_merge_publishes_and_leaves_development_alone(self):
        self.advance_upstream()
        (self.repo / "feature.txt").write_text("unfinished local work\n")
        result = self.sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.git(self.repo, "merge-base", "--is-ancestor", self.target, "origin/personal")
        self.git(self.repo, "merge-base", "--is-ancestor", self.base, "origin/personal")
        custom = self.git(self.root, "--git-dir", str(self.origin), "show", "personal:custom.txt")
        self.assertEqual(custom, "intentional customization\n")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD").strip(), self.base)
        self.assertEqual((self.repo / "feature.txt").read_text(), "unfinished local work\n")
        self.assertFalse((self.root / "t3code-upstream-sync").exists())

    def test_failed_checks_keep_candidate_without_publishing(self):
        self.advance_upstream()
        result = self.sync(TEST_CHECK_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.personal(), self.base)
        self.assertTrue((self.root / "t3code-upstream-sync").exists())
        self.assertNotEqual(self.sync().returncode, 0)

    def test_uncertain_agent_cannot_publish_even_with_zero_exit(self):
        self.advance_upstream()
        result = self.sync(TEST_BLOCKED="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.personal(), self.base)

    def test_agent_that_did_not_merge_cannot_publish(self):
        self.advance_upstream()
        self.assertNotEqual(self.sync(TEST_SKIP_MERGE="1").returncode, 0)
        self.assertEqual(self.personal(), self.base)

    def test_concurrent_remote_change_is_preserved(self):
        self.advance_upstream()
        (self.repo / "another.txt").write_text("another clone's work\n")
        self.git(self.repo, "add", "another.txt")
        self.git(self.repo, "commit", "-m", "concurrent work")
        race = self.git(self.repo, "rev-parse", "HEAD").strip()
        self.git(self.repo, "push", "origin", "HEAD:refs/heads/race-fixture")
        result = self.sync(TEST_RACE=race)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.personal(), race)

    def test_check_only_does_not_update_remote_main(self):
        self.advance_upstream()
        self.assertEqual(self.sync("--check").returncode, 0)
        main = self.git(self.root, "--git-dir", str(self.origin), "rev-parse", "main").strip()
        self.assertEqual(main, self.upstream_base)
        self.assertEqual(self.personal(), self.base)

    def test_subscription_login_required(self):
        self.advance_upstream()
        result = self.sync(TEST_LOGIN="Logged in using an API key")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.personal(), self.base)
        self.assertFalse((self.root / "t3code-upstream-sync").exists())


if __name__ == "__main__":
    unittest.main()
