"""ID: the binary is hcodex, keeps its own home, and defaults to the local proxy."""

import os
import tempfile
import shutil

from harness_lib import HarnessTest


class Identity(HarnessTest):
    def default_run(self, extra_env=None):
        """A turn with no config at all: only HOME and HCODEX_PROXY_URL are set."""
        provider = self.provider(models=("claude-sonnet-5.5", "other-model"))
        sandbox = self.sandbox()
        home = tempfile.mkdtemp(prefix="hcodex-home-")
        self.addCleanup(shutil.rmtree, home, True)
        env = {"CODEX_HOME": None, "HOME": home, "HCODEX_PROXY_URL": provider.base_url, **(extra_env or {})}
        result = sandbox.exec("Reply with exactly: pong", env=env)
        return provider, home, result

    def test_ID01_binary_runs(self):
        """The binary starts and prints a version."""
        code, output = self.sandbox().run("--version")
        self.assertEqual(code, 0, output)
        self.assertRegex(output, r"\d+\.\d+\.\d+")

    def test_ID02_default_home_is_dot_hcodex(self):
        """Without CODEX_HOME the state goes to ~/.hcodex and ~/.codex is never created."""
        _provider, home, result = self.default_run()
        self.assertEqual(result.last_message.strip(), "pong", result.output)
        self.assertTrue(os.path.isdir(os.path.join(home, ".hcodex")), os.listdir(home))
        self.assertFalse(os.path.exists(os.path.join(home, ".codex")), "hcodex created ~/.codex")

    def test_ID03_default_provider_is_local_proxy(self):
        """With no config the turn goes to the built-in `local-proxy` provider at HCODEX_PROXY_URL."""
        provider, _home, result = self.default_run()
        self.assertIn("provider: local-proxy", result.output)
        self.assertEqual(len(provider.turns()), 1, result.output)

    def test_ID04_default_model_on_local_proxy(self):
        """The default model on `local-proxy` is claude-sonnet-5.5."""
        provider, _home, result = self.default_run()
        self.assertEqual([t["model"] for t in provider.turns()], ["claude-sonnet-5.5"], result.output)

    def test_ID05_proxy_api_key_is_sent_as_bearer(self):
        """HCODEX_PROXY_API_KEY is sent to the local proxy as a bearer token."""
        provider, _home, result = self.default_run({"HCODEX_PROXY_API_KEY": "test-key-123"})
        self.assertEqual(provider.posts()[0]["headers"].get("authorization"), "Bearer test-key-123", result.output)

    def test_ID06_no_auth_header_without_key(self):
        """Without HCODEX_PROXY_API_KEY no Authorization header reaches the local proxy."""
        provider, _home, result = self.default_run()
        self.assertNotIn("authorization", provider.posts()[0]["headers"], result.output)

    def test_ID07_codex_home_is_respected(self):
        """CODEX_HOME moves all state: the session is recorded under it."""
        _provider, sandbox = self.single()
        result = sandbox.exec("Reply with exactly: pong")
        self.assertEqual(result.returncode, 0, result.output)
        rollouts = [
            name
            for _dir, _subdirs, files in os.walk(os.path.join(sandbox.home, "sessions"))
            for name in files
            if name.startswith("rollout-")
        ]
        self.assertEqual(len(rollouts), 1, f"expected one recorded session under CODEX_HOME, found {rollouts}")

    def test_ID08_banner_is_branded_hcodex(self):
        """The exec banner says hcodex, not OpenAI Codex."""
        _provider, sandbox = self.single()
        result = sandbox.exec("Reply with exactly: pong")
        self.assertIn("hcodex", result.output)
        self.assertNotIn("OpenAI Codex", result.output)
