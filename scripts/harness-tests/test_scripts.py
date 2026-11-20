"""SC: the harness's own scripts and the files it ships in the repo."""

import glob
import os
import shutil
import subprocess
import unittest

from harness_lib import BIN, REPO, HarnessTest, say

SCRIPTS = os.path.join(REPO, "scripts")
APP = os.path.join(REPO, "hcodex-app")
SHELL_SCRIPTS = sorted(
    glob.glob(os.path.join(SCRIPTS, "hc-*.sh"))
    + [os.path.join(SCRIPTS, name) for name in ("harness-smoke.sh", "harness-test.sh", "sync-upstream.sh")]
)


class Scripts(HarnessTest):
    def test_SC01_shell_scripts_parse(self):
        """Every harness shell script passes `bash -n`."""
        self.assertTrue(SHELL_SCRIPTS)
        for script in SHELL_SCRIPTS:
            with self.subTest(script=os.path.basename(script)):
                self.assertTrue(os.path.exists(script), f"missing {script}")
                done = subprocess.run(["bash", "-n", script], capture_output=True, text=True)
                self.assertEqual(done.returncode, 0, done.stderr)

    def test_SC02_shell_scripts_are_executable(self):
        """Every harness shell script has its executable bit set."""
        for script in SHELL_SCRIPTS:
            with self.subTest(script=os.path.basename(script)):
                self.assertTrue(os.access(script, os.X_OK), f"{script} is not executable")

    def test_SC03_find_session_finds_a_recorded_session(self):
        """`hc-find-session.sh <keyword>` finds a session by text that appears in the conversation."""
        _provider, sandbox = self.single(replies=[say("the answer mentions zebra-crossing-4417")])
        sandbox.exec("first question")
        done = subprocess.run(
            [os.path.join(SCRIPTS, "hc-find-session.sh"), "zebra-crossing-4417"],
            env=sandbox.env(), capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("first question", done.stdout)

    def test_SC04_find_session_is_quiet_when_nothing_matches(self):
        """`hc-find-session.sh` with a keyword nobody said prints nothing and does not fail."""
        _provider, sandbox = self.single()
        sandbox.exec("first question")
        done = subprocess.run(
            [os.path.join(SCRIPTS, "hc-find-session.sh"), "no-such-keyword-9981"],
            env=sandbox.env(), capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout.strip(), "")

    def test_SC05_shipped_skills_are_well_formed(self):
        """Every skill shipped in docs/hcodex-skills has a SKILL.md with `name` and `description` front matter."""
        skills = sorted(glob.glob(os.path.join(REPO, "docs", "hcodex-skills", "*", "SKILL.md")))
        self.assertTrue(skills, "no skills found under docs/hcodex-skills")
        for path in skills:
            with self.subTest(skill=os.path.basename(os.path.dirname(path))):
                with open(path) as f:
                    text = f.read()
                self.assertTrue(text.startswith("---\n"), "SKILL.md has no front matter")
                front = text.split("---\n", 2)[1]
                self.assertRegex(front, r"(?m)^name:\s*\S")
                self.assertRegex(front, r"(?m)^description:\s*\S")

    def test_SC08_app_sends_permissions_on_start_resume_and_fork(self):
        """The app passes its Chat/Code permissions on `thread/start`, `thread/resume` and `thread/fork` (see AS-18)."""
        with open(os.path.join(APP, "src", "lib", "store.ts")) as f:
            source = f.read()
        for method in ("thread/start", "thread/resume", "thread/fork"):
            with self.subTest(method=method):
                call = source[source.index(f'"{method}"'):]
                self.assertIn("permissionsFor(", call[: call.index("});")], f"{method} is sent without permissions")

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_SC06_app_scripts_parse(self):
        """The desktop app's node scripts pass `node --check`."""
        for script in sorted(glob.glob(os.path.join(APP, "scripts", "*.mjs"))):
            with self.subTest(script=os.path.basename(script)):
                done = subprocess.run(["node", "--check", script], capture_output=True, text=True)
                self.assertEqual(done.returncode, 0, done.stderr)

    @unittest.skipUnless(
        shutil.which("pnpm") and os.path.isdir(os.path.join(APP, "node_modules")),
        "hcodex-app dependencies are not installed (cd hcodex-app && pnpm install)",
    )
    def test_SC07_app_type_checks_against_this_binary(self):
        """The desktop app type-checks against the protocol types generated from this binary."""
        env = dict(os.environ, CODEX_BIN=BIN if os.path.isabs(BIN) else (shutil.which(BIN) or BIN))
        generated = subprocess.run(["node", "scripts/gen-protocol.mjs"], cwd=APP, env=env, capture_output=True, text=True, timeout=180)
        self.assertEqual(generated.returncode, 0, generated.stdout + generated.stderr)
        checked = subprocess.run(["pnpm", "-s", "exec", "tsc", "--noEmit"], cwd=APP, env=env, capture_output=True, text=True, timeout=300)
        self.assertEqual(checked.returncode, 0, (checked.stdout + checked.stderr)[-3000:])
