"""AG: sub-agents through a provider that is not OpenAI (multi-agent v2)."""

import json

from harness_lib import HarnessTest, call, output_for, provider_toml, say, system_texts, user_texts

ROOT = "ROOT-PROMPT-3141"
TASK = "SUBTASK-7391: answer with the word sub-done"
V2 = "[features]\nmulti_agent_v2 = true\n"


def is_root(body: dict) -> bool:
    return any(ROOT in text for text in user_texts(body))


def scripted(spawn_args: dict, sub_reply=None):
    """A provider script: the root spawns one sub-agent, waits for it, then finishes.

    Requests are told apart by content, so it does not matter in which order they arrive
    or which provider the sub-agent lands on.
    """
    waits = {"n": 0}

    def reply(body: dict):
        if not is_root(body):
            return sub_reply(body) if sub_reply else say("sub-done-2718")
        if output_for(body, "spawn-1") is None:
            return call("collaboration__spawn_agent", {"task_name": "probe", "fork_turns": "none", **spawn_args}, "spawn-1")
        if "sub-done-2718" in json.dumps(body["input"]):
            return say("root-done")
        waits["n"] += 1
        if waits["n"] > 6:
            return say("root-gave-up")
        return call("collaboration__wait_agent", {"timeout_ms": 20000}, f"wait-{waits['n']}")

    return reply


class Agents(HarnessTest):
    def run_team(self, config_extra: str = V2, spawn_args: dict | None = None, roles: dict | None = None):
        script = scripted({"message": TASK, **(spawn_args or {})})
        main = self.provider(models=("mock-model", "cheap-model"), default=script)
        other = self.provider(models=("b-model",), default=script)
        config = (
            f'model_provider = "mock"\nmodel = "mock-model"\n{config_extra}\n'
            + provider_toml("mock", main.base_url)
            + provider_toml("b", other.base_url)
        )
        sandbox = self.sandbox(config)
        for name, text in (roles or {}).items():
            sandbox.write(f"agents/{name}.toml", text)
        result = sandbox.exec(ROOT, timeout=120)
        return main, other, result

    def sub_requests(self, *providers):
        return [body for provider in providers for body in provider.turns() if not is_root(body)]

    def test_AG01_sub_agent_receives_its_task(self):
        """The task given to `spawn_agent` reaches the sub-agent as a plain user message."""
        main, other, result = self.run_team()
        subs = self.sub_requests(main, other)
        self.assertTrue(subs, f"no sub-agent request reached a provider\n{result.output[-1200:]}")
        self.assertTrue(any("SUBTASK-7391" in text for text in user_texts(subs[0])), json.dumps(subs[0]["input"])[:1500])

    def test_AG02_no_agent_message_items_reach_the_provider(self):
        """No request carries an `agent_message` item; proxies drop item types they do not know."""
        main, other, _result = self.run_team()
        kinds = {item.get("type") for provider in (main, other) for body in provider.turns() for item in body["input"]}
        self.assertNotIn("agent_message", kinds)

    def test_AG03_parent_receives_the_sub_agent_answer(self):
        """The sub-agent's final answer comes back to the parent, which then finishes its own turn."""
        _main, _other, result = self.run_team()
        self.assertEqual(result.last_message.strip(), "root-done", result.output[-1200:])

    def test_AG04_default_subagent_model_is_used(self):
        """`[agents] default_subagent_model` is the model of a sub-agent spawned without a model."""
        main, other, result = self.run_team(config_extra=V2 + '[agents]\ndefault_subagent_model = "cheap-model"\n')
        subs = self.sub_requests(main, other)
        self.assertTrue(subs, result.output[-1200:])
        self.assertEqual(subs[0]["model"], "cheap-model")

    ROLE = (
        'name = "helper"\ndescription = "Test helper role"\nmodel = "b-model"\nmodel_provider = "b"\n'
        'developer_instructions = "ROLE-INSTRUCTIONS-6021"\n'
    )

    def test_AG05_role_runs_on_its_own_provider(self):
        """With `agent_role_provider` on, a role file's `model_provider` sends that sub-agent to the other provider."""
        main, other, result = self.run_team(
            config_extra=V2 + "agent_role_provider = true\n", spawn_args={"agent_type": "helper"}, roles={"helper": self.ROLE}
        )
        subs = self.sub_requests(other)
        self.assertTrue(subs, f"sub-agent did not reach provider b\n{result.output[-1200:]}")
        self.assertEqual(subs[0]["model"], "b-model")
        self.assertEqual(self.sub_requests(main), [])
        self.assertEqual(result.last_message.strip(), "root-done")

    def test_AG06_role_instructions_reach_the_sub_agent(self):
        """A role's `developer_instructions` are part of the sub-agent's system-level text."""
        main, other, result = self.run_team(
            config_extra=V2 + "agent_role_provider = true\n", spawn_args={"agent_type": "helper"}, roles={"helper": self.ROLE}
        )
        subs = self.sub_requests(main, other)
        self.assertTrue(subs, result.output[-1200:])
        self.assertIn("ROLE-INSTRUCTIONS-6021", "\n".join(system_texts(subs[0])))

    def test_AG07_role_provider_is_ignored_when_the_flag_is_off(self):
        """With `agent_role_provider` off (upstream behaviour) a role cannot move the sub-agent to another provider."""
        main, other, result = self.run_team(spawn_args={"agent_type": "helper"}, roles={"helper": self.ROLE})
        self.assertEqual(self.sub_requests(other), [], "role changed provider although the flag is off")
        self.assertTrue(self.sub_requests(main), result.output[-1200:])

    def test_AG08_sub_agent_prompt_opens_neutral(self):
        """A sub-agent's system prompt also opens without an OpenAI identity."""
        main, other, result = self.run_team()
        subs = self.sub_requests(main, other)
        self.assertTrue(subs, result.output[-1200:])
        opening = system_texts(subs[0])[0].strip().split("\n\n")[0]
        self.assertNotRegex(opening, r"(?i)\bcodex\b|openai|\bgpt")
