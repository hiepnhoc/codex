"""MD: the model catalog comes from the provider, plus model_overrides.toml."""

import time
import unittest

from harness_lib import HarnessTest, provider_toml, system_texts

# Slugs of the catalog bundled with upstream codex; none may appear for a proxy provider.
OPENAI_BUNDLED = ("gpt-5", "gpt-5-codex", "gpt-5.1", "gpt-5.1-codex", "codex-mini-latest", "o3", "o4-mini")


def entry(model_id: str, **extra) -> dict:
    return {"id": model_id, "object": "model", "owned_by": "mock", **extra}


class Models(HarnessTest):
    def catalog(self, a_models, b_models=("b-model",), overrides: str | None = None, model: str | None = None):
        a = self.provider(models=a_models)
        b = self.provider(models=b_models)
        first = model or (a_models[0] if isinstance(a_models[0], str) else a_models[0]["id"])
        sandbox = self.sandbox(
            f'model_provider = "a"\nmodel = "{first}"\n' + provider_toml("a", a.base_url) + provider_toml("b", b.base_url)
        )
        if overrides is not None:
            sandbox.write("model_overrides.toml", overrides)
        return a, b, sandbox

    def listed(self, sandbox, params=None) -> list[dict]:
        server = sandbox.app_server()
        server.initialize()
        return server.request("model/list", {"includeHidden": True, **(params or {})})["data"]

    def context_window(self, sandbox, model: str) -> int:
        server = sandbox.app_server()
        server.initialize()
        thread = server.request("thread/start", {"cwd": sandbox.cwd, "model": model, "approvalPolicy": "never", "sandbox": "read-only"})
        server.turn(thread["thread"]["id"], "hi")
        return server.wait_for("thread/tokenUsage/updated")["tokenUsage"]["modelContextWindow"]

    def test_MD01_model_list_is_the_providers_list(self):
        """`model/list` (what `/model` and the app show) is exactly what GET {base_url}/models returned."""
        _a, _b, sandbox = self.catalog(("claude-opus-5.5", "gemini-3.8-flash-high", "gpt-6.1-terra"))
        self.assertEqual(
            sorted(m["model"] for m in self.listed(sandbox)), ["claude-opus-5.5", "gemini-3.8-flash-high", "gpt-6.1-terra"]
        )

    def test_MD02_openai_bundled_catalog_is_not_mixed_in(self):
        """None of upstream's bundled OpenAI models appear in a proxy provider's list."""
        _a, _b, sandbox = self.catalog(("claude-opus-5.5",))
        models = {m["model"] for m in self.listed(sandbox)}
        self.assertEqual(models & set(OPENAI_BUNDLED), set())

    def test_MD03_model_list_for_another_provider(self):
        """`model/list {modelProvider}` lists that provider's models (the app's cross-provider picker)."""
        _a, _b, sandbox = self.catalog(("a-model",), ("b-one", "b-two"))
        self.assertEqual(sorted(m["model"] for m in self.listed(sandbox, {"modelProvider": "b"})), ["b-one", "b-two"])

    def test_MD04_effort_ids_fold_into_one_model(self):
        """Ids `<model>-effort-<level>` become the effort scale of `<model>` and are not listed themselves."""
        _a, _b, sandbox = self.catalog(("plain", "eff", "eff-effort-low", "eff-effort-high"))
        models = {m["model"]: m for m in self.listed(sandbox)}
        self.assertEqual(sorted(models), ["eff", "plain"])
        self.assertEqual([e["reasoningEffort"] for e in models["eff"]["supportedReasoningEfforts"]], ["low", "high"])

    def test_MD05_default_effort_prefers_medium(self):
        """The default effort is `medium` when the provider offers it, else the first level offered."""
        ids = ("with-medium", "with-medium-effort-low", "with-medium-effort-medium", "with-medium-effort-high",
               "no-medium", "no-medium-effort-low", "no-medium-effort-high")
        _a, _b, sandbox = self.catalog(ids)
        models = {m["model"]: m for m in self.listed(sandbox)}
        self.assertEqual(models["with-medium"]["defaultReasoningEffort"], "medium")
        self.assertEqual(models["no-medium"]["defaultReasoningEffort"], "low")

    def test_MD06_context_window_comes_from_the_provider(self):
        """A model's `context_window` published in /models sizes the session's context window."""
        _a, _b, sandbox = self.catalog((entry("small-ctx", context_window=120000), "plain"))
        small = self.context_window(sandbox, "small-ctx")
        default = self.context_window(sandbox, "plain")
        self.assertLessEqual(small, 120000)
        self.assertGreater(small, 100000)
        self.assertGreater(default, 500000, "models without metadata should keep the 1M default")

    def test_MD07_input_modalities_come_from_the_provider(self):
        """A model's `input_modalities` published in /models decides whether it takes images."""
        _a, _b, sandbox = self.catalog((entry("text-only", input_modalities=["text"]), "plain"))
        models = {m["model"]: m for m in self.listed(sandbox)}
        self.assertEqual(models["text-only"]["inputModalities"], ["text"])
        self.assertIn("image", models["plain"]["inputModalities"])

    def test_MD08_override_sets_context_window(self):
        """`[models."<slug>"] context_window` in model_overrides.toml wins over the provider's value."""
        overrides = '[models."a-model"]\ncontext_window = 200000\n'
        _a, _b, sandbox = self.catalog((entry("a-model", context_window=900000),), overrides=overrides)
        window = self.context_window(sandbox, "a-model")
        self.assertLessEqual(window, 200000)
        self.assertGreater(window, 150000)

    def test_MD09_provider_specific_override_wins(self):
        """`[providers.<id>.models."<slug>"]` wins over the general `[models."<slug>"]` entry."""
        overrides = '[models."a-model"]\ncontext_window = 400000\n\n[providers.a.models."a-model"]\ncontext_window = 100000\n'
        _a, _b, sandbox = self.catalog(("a-model",), overrides=overrides)
        self.assertLessEqual(self.context_window(sandbox, "a-model"), 100000)

    EFFORT_OVERRIDE = '[models."a-model"]\nsupported_reasoning_efforts = ["medium", "high"]\ndefault_reasoning_effort = "high"\n'

    def test_MD10_override_default_effort_is_sent(self):
        """`default_reasoning_effort` in model_overrides.toml is the effort sent to the provider."""
        a, _b, sandbox = self.catalog(("a-model",), overrides=self.EFFORT_OVERRIDE)
        result = sandbox.exec("hi")
        self.assertEqual((a.turns()[0].get("reasoning") or {}).get("effort"), "high", result.output[-600:])

    def test_MD11_override_instructions_reach_the_provider(self):
        """`instructions` in model_overrides.toml become that model's system prompt."""
        overrides = '[models."a-model"]\ninstructions = "OVERRIDE-PROMPT-4410 for this model."\n'
        a, _b, sandbox = self.catalog(("a-model",), overrides=overrides)
        result = sandbox.exec("hi")
        self.assertIn("OVERRIDE-PROMPT-4410", "\n".join(system_texts(a.turns()[0])), result.output[-600:])

    def test_MD12_override_instructions_file_is_relative_to_the_overrides_file(self):
        """`instructions_file` is read relative to model_overrides.toml."""
        overrides = '[models."a-model"]\ninstructions_file = "prompts/a.md"\n'
        a, _b, sandbox = self.catalog(("a-model",), overrides=overrides)
        sandbox.write("prompts/a.md", "FILE-PROMPT-9034 for this model.\n")
        result = sandbox.exec("hi")
        self.assertIn("FILE-PROMPT-9034", "\n".join(system_texts(a.turns()[0])), result.output[-600:])

    def test_MD13_turn_works_when_the_model_list_is_unavailable(self):
        """A provider whose /models fails still serves turns for an explicitly chosen model."""
        provider, sandbox = self.single(models_status=500)
        result = sandbox.exec("Reply with exactly: pong")
        self.assertEqual(result.last_message.strip(), "pong", result.output[-600:])

    def test_MD14_model_list_of_a_dead_provider_does_not_hang(self):
        """Listing models of an unreachable provider returns (empty or an error) within seconds."""
        _a, b, sandbox = self.catalog(("a-model",))
        b.close()
        server = sandbox.app_server()
        server.initialize()
        started = time.time()
        try:
            data = server.request("model/list", {"modelProvider": "b", "includeHidden": True}, timeout=30)["data"]
        except Exception:
            data = []
        self.assertLess(time.time() - started, 25)
        self.assertEqual(data, [])

    @unittest.expectedFailure
    def test_MD16_override_efforts_show_in_the_model_list(self):
        """KNOWN GAP: effort overrides from model_overrides.toml should show in `model/list` (they only reach requests).

        Found 20/11/2026: the app-server's model list still reports the provider's scale
        (low/medium/high/xhigh), so the app's picker offers levels the override removed.
        Remove `expectedFailure` once the list applies the overrides.
        """
        _a, _b, sandbox = self.catalog(("a-model",), overrides=self.EFFORT_OVERRIDE)
        model = self.listed(sandbox)[0]
        self.assertEqual([e["reasoningEffort"] for e in model["supportedReasoningEfforts"]], ["medium", "high"])
        self.assertEqual(model["defaultReasoningEffort"], "high")

    def test_MD15_configured_providers_are_listed(self):
        """`modelProvider/list` contains every provider in config (the app's Providers page)."""
        _a, _b, sandbox = self.catalog(("a-model",))
        server = sandbox.app_server()
        server.initialize()
        ids = {p["id"] for p in server.request("modelProvider/list", {})["data"]}
        self.assertLessEqual({"a", "b"}, ids)
