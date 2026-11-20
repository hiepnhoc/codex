"""RQ: what hcodex sends to a provider that is not OpenAI."""

import os
import re
import sys

from harness_lib import HarnessTest, call, find_tool, output_for, say, system_texts, tool_names

HERE = os.path.dirname(os.path.abspath(__file__))
# `\bcodex\b` does not match the harness's own name, "hcodex".
OPENAI_IDENTITY = re.compile(r"\bcodex\b|openai|\bgpt", re.I)


class Request(HarnessTest):
    def test_RQ01_system_prompt_opens_neutral_for_every_model_family(self):
        """The system prompt never opens by calling the agent Codex / OpenAI / GPT (Gemini answers that with 429)."""
        for model in ("gemini-3.8-flash-high", "claude-sonnet-5.5", "gpt-6.1-terra", "qwen3-coder-plus", "glm-4.6"):
            with self.subTest(model=model):
                provider, sandbox = self.single(model=model)
                result = sandbox.exec("Reply with exactly: pong")
                turns = provider.turns()
                self.assertEqual(len(turns), 1, result.output)
                texts = system_texts(turns[0])
                self.assertTrue(texts, "request carries no system prompt")
                opening = texts[0].strip().split("\n\n")[0]
                self.assertNotRegex(opening, OPENAI_IDENTITY)
                self.assertIn("hcodex", opening)

    def test_RQ02_no_namespace_tools_reach_the_provider(self):
        """No tool of type `namespace` is sent; proxies drop tool types they do not know."""
        provider, sandbox = self.single()
        sandbox.exec("hi")
        tools = provider.turns()[0]["tools"]
        self.assertNotIn("namespace", [t.get("type") for t in tools])
        self.assertIn("exec_command", tool_names(provider.turns()[0]))

    def test_RQ03_multi_agent_tools_are_flattened(self):
        """Multi-agent v2 tools arrive as plain functions named `collaboration__<tool>`."""
        provider, sandbox = self.single(config_extra="[features]\nmulti_agent_v2 = true\n")
        sandbox.exec("hi")
        names = tool_names(provider.turns()[0])
        for tool in ("spawn_agent", "wait_agent", "send_message", "list_agents"):
            self.assertIn(f"collaboration__{tool}", names)

    def mcp_config(self):
        return (
            "[mcp_servers.echo]\n"
            f'command = "{sys.executable}"\n'
            f'args = ["{os.path.join(HERE, "mcp_echo.py")}"]\n'
        )

    def test_RQ04_mcp_tools_are_flattened(self):
        """An MCP server's tool arrives as the plain function `mcp__<server>__<tool>`."""
        provider, sandbox = self.single(config_extra=self.mcp_config())
        result = sandbox.exec("hi")
        names = tool_names(provider.turns()[0])
        self.assertIn("mcp__echo__echo", names, f"tools sent: {names}\n{result.output[-600:]}")

    def test_RQ05_flattened_mcp_call_reaches_the_mcp_server(self):
        """A call to `mcp__<server>__<tool>` is routed back to that MCP server and its output returned."""
        provider, sandbox = self.single(
            config_extra=self.mcp_config(),
            replies=[call("mcp__echo__echo", {"text": "mcp-ok-42"}, "mcp-1"), say("done")],
        )
        result = sandbox.exec("use the echo tool", "--dangerously-bypass-approvals-and-sandbox")
        turns = provider.turns()
        self.assertGreaterEqual(len(turns), 2, result.output[-800:])
        self.assertIn("echo:mcp-ok-42", output_for(turns[1], "mcp-1") or "", result.output[-800:])

    def test_RQ06_requested_model_is_sent_unchanged(self):
        """`-m <slug>` reaches the provider as-is, including dots and suffixes."""
        provider, sandbox = self.single(models=("mock-model", "claude-opus-5.5", "gpt-6.1-terra"))
        for model in ("claude-opus-5.5", "gpt-6.1-terra"):
            sandbox.exec("hi", "-m", model, "--ephemeral")
        self.assertEqual([t["model"] for t in provider.turns()], ["claude-opus-5.5", "gpt-6.1-terra"])

    def test_RQ07_request_is_a_streamed_responses_call(self):
        """The provider is called at POST {base_url}/responses with `stream: true`."""
        provider, sandbox = self.single()
        sandbox.exec("hi")
        post = provider.posts()[0]
        self.assertTrue(post["path"].endswith("/v1/responses"), post["path"])
        self.assertIs(post["body"].get("stream"), True)

    def test_RQ08_shell_tool_is_offered(self):
        """A shell tool is always offered, so the agent can act in the workspace."""
        provider, sandbox = self.single()
        sandbox.exec("hi")
        self.assertIsNotNone(find_tool(provider.turns()[0], "exec_command", "shell", "local_shell"))
