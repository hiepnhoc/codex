"""TN: a turn end to end: answer, tool round trip, sandbox, session record and resume."""

import json
import os

from harness_lib import HarnessTest, call, output_for, say, user_texts


class Turn(HarnessTest):
    def test_TN01_plain_answer(self):
        """A text answer from the provider is the turn's final message."""
        provider, sandbox = self.single(replies=[say("pong")])
        result = sandbox.exec("Reply with exactly: pong")
        self.assertEqual(result.returncode, 0, result.output)
        self.assertEqual(result.last_message.strip(), "pong")
        self.assertEqual(len(provider.turns()), 1)

    def test_TN02_user_prompt_reaches_the_provider(self):
        """The user's prompt is sent as a user message."""
        provider, sandbox = self.single()
        sandbox.exec("PROMPT-MARKER-5512")
        self.assertTrue(any("PROMPT-MARKER-5512" in text for text in user_texts(provider.turns()[0])))

    def test_TN03_shell_tool_round_trip(self):
        """A shell call from the model runs, and its output goes back in the next request."""
        provider, sandbox = self.single(replies=[call("exec_command", {"cmd": "echo harness-ok-17"}, "sh-1"), say("done")])
        result = sandbox.exec("run it")
        turns = provider.turns()
        self.assertEqual(len(turns), 2, result.output[-800:])
        self.assertIn("harness-ok-17", output_for(turns[1], "sh-1") or "")
        self.assertEqual(result.last_message.strip(), "done")

    def test_TN04_read_only_sandbox_blocks_writes(self):
        """In the default read-only sandbox a shell call cannot create a file in the workspace."""
        provider, sandbox = self.single(replies=[call("exec_command", {"cmd": "touch blocked.txt"}, "sh-1"), say("done")])
        sandbox.exec("write a file")
        self.assertEqual(len(provider.turns()), 2)
        self.assertFalse(os.path.exists(os.path.join(sandbox.cwd, "blocked.txt")))

    def test_TN05_workspace_write_allows_writes_inside_the_workspace(self):
        """With `--sandbox workspace-write` a shell call can create a file in the workspace."""
        provider, sandbox = self.single(replies=[call("exec_command", {"cmd": "echo hi > made.txt"}, "sh-1"), say("done")])
        result = sandbox.exec("write a file", "--sandbox", "workspace-write")
        self.assertTrue(os.path.exists(os.path.join(sandbox.cwd, "made.txt")), result.output[-800:])

    def test_TN06_workspace_write_blocks_writes_outside_the_workspace(self):
        """With `--sandbox workspace-write` a shell call cannot write outside the workspace."""
        outside = os.path.join(os.path.expanduser("~"), f".hcodex-test-outside-{os.getpid()}")
        self.addCleanup(lambda: os.path.exists(outside) and os.remove(outside))
        provider, sandbox = self.single(replies=[call("exec_command", {"cmd": f"touch {outside}"}, "sh-1"), say("done")])
        sandbox.exec("write outside", "--sandbox", "workspace-write")
        self.assertEqual(len(provider.turns()), 2)
        self.assertFalse(os.path.exists(outside))

    def test_TN07_resume_carries_the_earlier_conversation(self):
        """`exec resume --last` sends the earlier prompt and answer again, so the model keeps context."""
        provider, sandbox = self.single(replies=[say("first-answer-881"), say("second")])
        sandbox.exec("first-question-880")
        result = sandbox.exec("second-question", "resume", "--last")
        turns = provider.turns()
        self.assertEqual(len(turns), 2, result.output[-800:])
        history = json.dumps(turns[1]["input"])
        self.assertIn("first-question-880", history)
        self.assertIn("first-answer-881", history)
        self.assertIn("second-question", history)

    def test_TN08_ephemeral_turn_leaves_no_session(self):
        """`--ephemeral` records no session file."""
        _provider, sandbox = self.single()
        sandbox.exec("hi", "--ephemeral")
        sessions = os.path.join(sandbox.home, "sessions")
        rollouts = [n for _d, _s, files in os.walk(sessions) for n in files if n.startswith("rollout-")]
        self.assertEqual(rollouts, [])

    def test_TN09_token_usage_is_reported(self):
        """Token usage from the provider's `response.completed` is shown at the end of the turn."""
        _provider, sandbox = self.single()
        result = sandbox.exec("hi")
        self.assertIn("tokens used", result.output)
        self.assertIn("128", result.output)
