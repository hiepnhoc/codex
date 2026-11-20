"""LV: the real ~/.hcodex on this machine. Read-only; never prints a credential.

Not part of the default run: these depend on the machine's own config and, for a few, on
providers being reachable. Enable with `scripts/harness-test.sh --live` (HCODEX_TEST_LIVE=1).
A provider that cannot be reached skips its test instead of failing it.
"""

import glob
import json
import os
import shutil
import subprocess
import time
import tomllib
import unittest
import urllib.error
import urllib.request

from harness_lib import BIN, HarnessTest

HOME = os.environ.get("HCODEX_LIVE_HOME") or os.path.expanduser("~/.hcodex")
CONFIG = os.path.join(HOME, "config.toml")
LIVE = os.environ.get("HCODEX_TEST_LIVE") == "1" and os.path.exists(CONFIG)
# Providers built into the binary; they need no [model_providers.<id>] entry.
BUILT_IN = {"local-proxy", "openai", "ollama", "lmstudio", "amazon-bedrock"}
LOCAL_PROXY_URL = os.environ.get("HCODEX_PROXY_URL", "http://127.0.0.1:8181/v1")
LOCAL_PROXY_MODEL = "claude-sonnet-5.5"


def load(path: str) -> dict:
    with open(path, "rb") as f:
        return tomllib.load(f)


@unittest.skipUnless(LIVE, "live checks are off (run scripts/harness-test.sh --live)")
class Live(HarnessTest):
    @classmethod
    def setUpClass(cls):
        cls.config = load(CONFIG)
        cls.providers = cls.config.get("model_providers", {})
        cls._catalogs = {}

    def hcodex(self, *args: str, timeout: float = 30):
        env = dict(os.environ)
        env.pop("CODEX_HOME", None)
        if HOME != os.path.expanduser("~/.hcodex"):
            env["CODEX_HOME"] = HOME
        return subprocess.run([BIN, *args], env=env, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)

    def base_url(self, provider: str) -> str | None:
        if provider in self.providers:
            return self.providers[provider].get("base_url")
        return LOCAL_PROXY_URL if provider == "local-proxy" else None

    def token(self, provider: str) -> str:
        """The provider's key, for an Authorization header only. Never printed or put in a message."""
        info = self.providers.get(provider, {})
        if info.get("experimental_bearer_token"):
            return info["experimental_bearer_token"]
        if info.get("env_key"):
            return os.environ.get(info["env_key"], "")
        auth = info.get("auth") or {}
        if auth.get("command"):
            done = subprocess.run([auth["command"], *auth.get("args", [])], capture_output=True, text=True, timeout=20)
            return done.stdout.strip()
        return ""

    def catalog(self, provider: str) -> set[str]:
        """Model ids the provider lists right now; skips the test when it cannot be reached."""
        if provider not in self._catalogs:
            url = self.base_url(provider)
            if not url:
                self.skipTest(f"provider {provider} has no base_url to ask")
            request = urllib.request.Request(url.rstrip("/") + "/models")
            token = self.token(provider)
            if token:
                request.add_header("Authorization", f"Bearer {token}")
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                with opener.open(request, timeout=8) as response:
                    data = json.load(response).get("data", [])
            except (urllib.error.URLError, OSError, ValueError) as e:
                self.skipTest(f"provider {provider} is not reachable right now ({type(e).__name__})")
            self._catalogs[provider] = {m.get("id", "") for m in data}
        return self._catalogs[provider]

    def has_model(self, provider: str, model: str) -> bool:
        ids = self.catalog(provider)
        return model in ids or any(i.startswith(model + "-effort-") for i in ids)

    def default_provider(self) -> str:
        return self.config.get("model_provider", "local-proxy")

    # ---- config

    def test_LV01_config_parses(self):
        """~/.hcodex/config.toml is valid TOML."""
        self.assertIsInstance(self.config, dict)

    def test_LV02_hcodex_accepts_the_config(self):
        """The installed hcodex loads the real config without a config error."""
        done = self.hcodex("features", "list")
        self.assertEqual(done.returncode, 0, done.stderr[-800:])
        self.assertNotRegex(done.stderr, r"(?i)error loading config|invalid config|unknown field")

    def test_LV03_every_provider_speaks_responses(self):
        """Every configured provider has a base_url and `wire_api = "responses"` (the only API hcodex speaks)."""
        for name, info in self.providers.items():
            with self.subTest(provider=name):
                self.assertTrue(info.get("base_url"), "no base_url")
                self.assertEqual(info.get("wire_api", "responses"), "responses")

    def test_LV04_default_provider_exists(self):
        """`model_provider` in config names a configured or built-in provider."""
        provider = self.default_provider()
        self.assertIn(provider, set(self.providers) | BUILT_IN)

    def test_LV05_profiles_point_at_existing_providers(self):
        """Every profile file `<name>.config.toml` parses and names a provider that exists."""
        known = set(self.providers) | BUILT_IN
        for path in sorted(glob.glob(os.path.join(HOME, "*.config.toml"))):
            with self.subTest(profile=os.path.basename(path)):
                profile = load(path)
                provider = profile.get("model_provider")
                if provider is not None:
                    self.assertIn(provider, known | set(profile.get("model_providers", {})))

    def test_LV06_feature_flags_the_harness_relies_on(self):
        """The flags the documented workflow needs are on: multi_agent_v2 and agent_role_provider."""
        features = self.config.get("features", {})
        self.assertIs(features.get("multi_agent_v2"), True)
        self.assertIs(features.get("agent_role_provider"), True)

    # ---- credentials

    def test_LV07_auth_commands_exist(self):
        """Every provider `auth.command` points at an executable that exists."""
        for name, info in self.providers.items():
            command = (info.get("auth") or {}).get("command")
            if command:
                with self.subTest(provider=name):
                    resolved = command if os.path.isabs(command) else shutil.which(command)
                    self.assertTrue(resolved and os.access(resolved, os.X_OK), f"auth.command is not executable: {command}")

    def test_LV08_command_auth_providers_have_a_credential(self):
        """Every provider that reads its key through `auth.command` gets a non-empty key."""
        for name, info in self.providers.items():
            if (info.get("auth") or {}).get("command"):
                with self.subTest(provider=name):
                    self.assertTrue(self.token(name), "auth.command printed nothing")

    def test_LV09_credential_files_are_private(self):
        """Files in provider-credentials/ are readable by the owner only (mode 600)."""
        for path in sorted(glob.glob(os.path.join(HOME, "provider-credentials", "*.token"))):
            with self.subTest(file=os.path.basename(path)):
                self.assertEqual(os.stat(path).st_mode & 0o077, 0, "token file is readable by group or others")

    # ---- agents

    def roles(self) -> dict:
        return {os.path.basename(p)[: -len(".toml")]: load(p) for p in sorted(glob.glob(os.path.join(HOME, "agents", "*.toml")))}

    def test_LV10_role_files_parse(self):
        """Every role in ~/.hcodex/agents/*.toml parses and has a name and description."""
        roles = self.roles()
        for name, role in roles.items():
            with self.subTest(role=name):
                self.assertTrue(role.get("name"), "role has no name")
                self.assertTrue(role.get("description"), "role has no description")

    def test_LV11_roles_point_at_existing_providers(self):
        """Every role's `model_provider` is a configured or built-in provider."""
        known = set(self.providers) | BUILT_IN
        for name, role in self.roles().items():
            if role.get("model_provider"):
                with self.subTest(role=name):
                    self.assertIn(role["model_provider"], known)

    def test_LV12_role_models_exist_on_their_provider(self):
        """Every role's model is listed by the provider that role runs on (asks the provider; skips if down)."""
        checked = 0
        for name, role in self.roles().items():
            model, provider = role.get("model"), role.get("model_provider") or self.default_provider()
            if not model:
                continue
            with self.subTest(role=name, provider=provider):
                self.assertTrue(self.has_model(provider, model), f"{provider} does not list {model}")
                checked += 1
        if not checked:
            self.skipTest("no role model could be checked (providers unreachable)")

    def test_LV13_default_subagent_model_exists_on_the_default_provider(self):
        """`[agents] default_subagent_model` is listed by the default provider (else spawn_agent fails: Unknown model)."""
        model = self.config.get("agents", {}).get("default_subagent_model")
        if not model:
            self.skipTest("no default_subagent_model configured")
        self.assertTrue(self.has_model(self.default_provider(), model))

    def test_LV14_default_model_exists_on_the_default_provider(self):
        """The configured `model` is listed by the default provider."""
        model = self.config.get("model") or LOCAL_PROXY_MODEL
        self.assertTrue(self.has_model(self.default_provider(), model))

    # ---- skills, hooks, overrides

    def test_LV15_skills_have_no_broken_links(self):
        """Every entry under ~/.hcodex/skills resolves (no dangling symlink) and has a SKILL.md."""
        entries = sorted(glob.glob(os.path.join(HOME, "skills", "*")))
        for path in entries:
            if os.path.basename(path).startswith("."):
                continue
            with self.subTest(skill=os.path.basename(path)):
                self.assertTrue(os.path.exists(path), "dangling symlink")
                if os.path.isdir(path):
                    self.assertTrue(os.path.exists(os.path.join(path, "SKILL.md")), "no SKILL.md")

    def test_LV16_hooks_file_parses(self):
        """~/.hcodex/hooks.json, when present, is valid JSON."""
        path = os.path.join(HOME, "hooks.json")
        if not os.path.exists(path):
            self.skipTest("no hooks.json")
        with open(path) as f:
            self.assertIsInstance(json.load(f), dict)

    def test_LV17_model_overrides_parse(self):
        """~/.hcodex/model_overrides.toml, when present, parses and its prompt files exist."""
        path = os.path.join(HOME, "model_overrides.toml")
        if not os.path.exists(path):
            self.skipTest("no model_overrides.toml")
        overrides = load(path)
        tables = list(overrides.get("models", {}).items())
        for provider in overrides.get("providers", {}).values():
            tables += list(provider.get("models", {}).items())
        for slug, entry in tables:
            if entry.get("instructions_file"):
                with self.subTest(model=slug):
                    self.assertTrue(os.path.exists(os.path.join(HOME, entry["instructions_file"])), entry["instructions_file"])

    # ---- installation

    def test_LV18_binary_on_path_is_the_installed_one(self):
        """`hcodex` on PATH is ~/.hcodex/bin/hcodex (not a stale copy somewhere else)."""
        on_path = shutil.which("hcodex")
        self.assertTrue(on_path, "hcodex is not on PATH")
        self.assertEqual(os.path.realpath(on_path), os.path.realpath(os.path.join(HOME, "bin", "hcodex")))

    def test_LV19_original_codex_home_is_not_shared(self):
        """hcodex's home is not ~/.codex and is not a link to it."""
        self.assertNotEqual(os.path.realpath(HOME), os.path.realpath(os.path.expanduser("~/.codex")))

    def test_LV20_smoke_turns_name_configured_providers(self):
        """Every line of ~/.hcodex/smoke-turns.txt names a configured provider and a model."""
        path = os.path.join(HOME, "smoke-turns.txt")
        if not os.path.exists(path):
            self.skipTest("no smoke-turns.txt")
        with open(path) as f:
            lines = [line.split() for line in f if line.strip() and not line.lstrip().startswith("#")]
        self.assertTrue(lines, "smoke-turns.txt lists nothing")
        for parts in lines:
            with self.subTest(line=" ".join(parts)):
                self.assertEqual(len(parts), 2, "expected `provider model`")
                self.assertIn(parts[0], set(self.providers) | BUILT_IN)

    def test_LV21_nightly_sync_check_is_fresh(self):
        """The nightly upstream check ran within the last three days (~/.hcodex/sync-status.txt)."""
        path = os.path.join(HOME, "sync-status.txt")
        self.assertTrue(os.path.exists(path), "no sync-status.txt: is the nightly job installed? (scripts/sync-upstream.sh --install-nightly)")
        age_days = (time.time() - os.path.getmtime(path)) / 86400
        self.assertLess(age_days, 3, f"last upstream check was {age_days:.1f} days ago")
