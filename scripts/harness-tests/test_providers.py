"""PV: several providers side by side: routing, profiles, credentials, harness feature flags."""

import os

from harness_lib import BIN, HarnessTest, provider_toml


class Providers(HarnessTest):
    def pair(self, config_extra: str = "", b_extra: str = ""):
        a = self.provider(models=("a-model",))
        b = self.provider(models=("b-model",))
        config = (
            f'model_provider = "a"\nmodel = "a-model"\n{config_extra}\n'
            + provider_toml("a", a.base_url)
            + provider_toml("b", b.base_url, b_extra)
        )
        return a, b, self.sandbox(config)

    def test_PV01_turn_goes_to_the_configured_provider_only(self):
        """A turn reaches the provider named by `model_provider` and no other configured provider."""
        a, b, sandbox = self.pair()
        result = sandbox.exec("hi")
        self.assertEqual(len(a.turns()), 1, result.output[-600:])
        self.assertEqual(len(b.turns()), 0)

    def test_PV02_cli_override_switches_provider(self):
        """`-c model_provider=<id> -m <model>` sends the turn to that provider."""
        a, b, sandbox = self.pair()
        result = sandbox.exec("hi", "-c", "model_provider=b", "-m", "b-model")
        self.assertEqual([t["model"] for t in b.turns()], ["b-model"], result.output[-600:])
        self.assertEqual(len(a.turns()), 0)

    def test_PV03_profile_file_selects_provider_and_model(self):
        """`-p <name>` loads `<home>/<name>.config.toml` and uses its provider and model."""
        a, b, sandbox = self.pair()
        sandbox.write("second.config.toml", 'model_provider = "b"\nmodel = "b-model"\n')
        result = sandbox.exec("hi", "-p", "second")
        self.assertEqual([t["model"] for t in b.turns()], ["b-model"], result.output[-600:])
        self.assertEqual(len(a.turns()), 0)

    def test_PV04_provider_credential_prints_the_stored_token(self):
        """`hcodex provider-credential <id>` prints the token stored in provider-credentials/<id>.token."""
        _a, _b, sandbox = self.pair()
        path = sandbox.write("provider-credentials/b.token", "token-b-778\n")
        os.chmod(path, 0o600)
        code, output = sandbox.run("provider-credential", "b")
        self.assertEqual(code, 0, output)
        self.assertEqual(output.strip(), "token-b-778")

    def command_auth(self):
        a, b, sandbox = self.pair(b_extra=f'[model_providers.b.auth]\ncommand = "{BIN}"\nargs = ["provider-credential", "b"]\n')
        path = sandbox.write("provider-credentials/b.token", "token-b-778\n")
        os.chmod(path, 0o600)
        return a, b, sandbox

    def test_PV05_command_auth_token_is_sent_on_turns(self):
        """A provider whose key comes from `auth.command` gets it as a bearer token on POST /responses."""
        _a, b, sandbox = self.command_auth()
        result = sandbox.exec("hi", "-c", "model_provider=b", "-m", "b-model")
        self.assertEqual(len(b.posts()), 1, result.output[-600:])
        self.assertEqual(b.posts()[0]["headers"].get("authorization"), "Bearer token-b-778")

    def test_PV06_command_auth_token_is_sent_on_the_model_list(self):
        """The same bearer token is sent on GET /models (providers that protect it used to list no models)."""
        _a, b, sandbox = self.command_auth()
        sandbox.exec("hi", "-c", "model_provider=b", "-m", "b-model")
        gets = b.gets("/models")
        self.assertTrue(gets, "hcodex never asked the provider for its models")
        self.assertEqual(gets[0]["headers"].get("authorization"), "Bearer token-b-778")

    def test_PV07_env_key_is_sent_as_bearer(self):
        """A provider with `env_key` gets that environment variable as a bearer token."""
        _a, b, sandbox = self.pair(b_extra='env_key = "HCODEX_TEST_B_KEY"\n')
        result = sandbox.exec("hi", "-c", "model_provider=b", "-m", "b-model", env={"HCODEX_TEST_B_KEY": "env-key-551"})
        self.assertEqual(len(b.posts()), 1, result.output[-600:])
        self.assertEqual(b.posts()[0]["headers"].get("authorization"), "Bearer env-key-551")

    def test_PV08_inline_bearer_token_is_sent(self):
        """A provider with `experimental_bearer_token` gets it as a bearer token."""
        _a, b, sandbox = self.pair(b_extra='experimental_bearer_token = "inline-key-909"\n')
        result = sandbox.exec("hi", "-c", "model_provider=b", "-m", "b-model")
        self.assertEqual(len(b.posts()), 1, result.output[-600:])
        self.assertEqual(b.posts()[0]["headers"].get("authorization"), "Bearer inline-key-909")

    def test_PV09_keys_do_not_leak_to_other_providers(self):
        """One provider's key is never sent to another provider."""
        a, _b, sandbox = self.pair(b_extra='experimental_bearer_token = "inline-key-909"\n')
        sandbox.exec("hi")
        self.assertEqual(len(a.posts()), 1)
        self.assertNotIn("authorization", a.posts()[0]["headers"])

    def test_PV10_harness_feature_flags_load_cleanly(self):
        """The harness flags in the user's config are accepted: no unknown-key error, the turn runs."""
        flags = (
            "[features]\nmulti_agent_v2 = true\nagent_role_provider = true\n"
            "plugin_marketplace_auto_upgrade = false\nthread_keeps_provider = true\n"
        )
        a, _b, sandbox = self.pair(config_extra=flags)
        result = sandbox.exec("Reply with exactly: pong")
        self.assertEqual(result.last_message.strip(), "pong", result.output[-800:])
        self.assertNotRegex(result.output, r"(?i)unknown (feature|field|key)|invalid config")
        self.assertEqual(len(a.turns()), 1)

    def test_PV11_unknown_provider_is_reported(self):
        """Naming a provider that is not configured fails with a clear message instead of using another one."""
        a, b, sandbox = self.pair()
        result = sandbox.exec("hi", "-c", "model_provider=missing")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing", result.output)
        self.assertEqual(len(a.turns()) + len(b.turns()), 0)
