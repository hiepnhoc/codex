"""AS: the app-server calls the desktop app (hcodex-app) is built on."""

import base64
import json
import os
import time

from harness_lib import HarnessTest, RpcError, call, http_error, provider_toml, say, system_texts
from test_agents import ROOT, TASK, V2, is_root, scripted

CHAT = {"approvalPolicy": "never", "sandbox": "read-only"}
CODE = {"approvalPolicy": "on-request", "sandbox": "workspace-write"}


def b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


class AppServerContract(HarnessTest):
    def setup(self, replies=(), config_extra: str = "", **provider_kwargs):
        a = self.provider(models=("a-model", "a-cheap"), replies=replies, **provider_kwargs)
        b = self.provider(models=("b-model",))
        sandbox = self.sandbox(
            f'model_provider = "a"\nmodel = "a-model"\n{config_extra}\n'
            + provider_toml("a", a.base_url)
            + provider_toml("b", b.base_url)
        )
        server = sandbox.app_server()
        self.init = server.initialize()
        return a, b, sandbox, server

    def start(self, server, sandbox, **params) -> str:
        return server.request("thread/start", {"cwd": sandbox.cwd, **CODE, **params})["thread"]["id"]

    # ---- start-up

    def test_AS01_initialize_reports_the_home(self):
        """`initialize` returns `codexHome`; the app derives its chat folder from it."""
        _a, _b, sandbox, _server = self.setup()
        self.assertEqual(os.path.realpath(self.init["codexHome"]), os.path.realpath(sandbox.home))

    def test_AS02_create_directory_makes_the_chat_folder(self):
        """`fs/createDirectory {recursive}` creates `<home>/chat`, and is fine when it already exists."""
        _a, _b, sandbox, server = self.setup()
        chat = os.path.join(self.init["codexHome"], "chat")
        server.request("fs/createDirectory", {"path": chat, "recursive": True})
        server.request("fs/createDirectory", {"path": chat, "recursive": True})
        self.assertTrue(os.path.isdir(chat))

    def test_AS03_config_read_gives_the_default_model(self):
        """`config/read` returns the configured model and provider (the app's default choice)."""
        _a, _b, sandbox, server = self.setup()
        config = server.request("config/read", {"cwd": sandbox.cwd})["config"]
        self.assertEqual(config.get("model"), "a-model")
        self.assertEqual(config.get("model_provider"), "a")

    # ---- Chat and Code sessions

    def test_AS04_chat_session_is_read_only(self):
        """A Chat session starts with sandbox read-only and approvals never, as recorded in the answer."""
        _a, _b, sandbox, server = self.setup()
        started = server.request("thread/start", {"cwd": sandbox.cwd, **CHAT})
        self.assertEqual(started["approvalPolicy"], "never")
        self.assertEqual(started["sandbox"]["type"], "readOnly")

    def test_AS05_chat_session_cannot_write_files(self):
        """In a Chat session a shell call from the model cannot create a file."""
        a, _b, sandbox, server = self.setup(replies=[call("exec_command", {"cmd": "touch chat-wrote.txt"}, "sh-1"), say("done")])
        thread = server.request("thread/start", {"cwd": sandbox.cwd, **CHAT})["thread"]["id"]
        turn = server.turn(thread, "write a file")
        self.assertEqual(turn["status"], "completed")
        self.assertEqual(len(a.turns()), 2)
        self.assertFalse(os.path.exists(os.path.join(sandbox.cwd, "chat-wrote.txt")))

    def test_AS06_code_session_can_write_in_the_workspace(self):
        """In a Code session a shell call from the model creates a file in the workspace."""
        _a, _b, sandbox, server = self.setup(replies=[call("exec_command", {"cmd": "echo hi > code-wrote.txt"}, "sh-1"), say("done")])
        turn = server.turn(self.start(server, sandbox), "write a file")
        self.assertEqual(turn["status"], "completed")
        self.assertTrue(os.path.exists(os.path.join(sandbox.cwd, "code-wrote.txt")))

    def test_AS07_developer_instructions_reach_the_provider(self):
        """`developerInstructions` given at `thread/start` (the Chat-mode brief) are sent to the model."""
        a, _b, sandbox, server = self.setup()
        thread = self.start(server, sandbox, developerInstructions="CHAT-BRIEF-7755: answer without editing files.")
        server.turn(thread, "hi")
        self.assertIn("CHAT-BRIEF-7755", "\n".join(system_texts(a.turns()[0])))

    def test_AS08_escalation_asks_the_client_for_approval(self):
        """A command that asks to leave the sandbox produces an approval request to the client."""
        escalated = {"cmd": "echo escalated-ok", "sandbox_permissions": "require_escalated", "justification": "test"}
        _a, _b, sandbox, server = self.setup(replies=[call("exec_command", escalated, "sh-1"), say("done")])
        server.turn(self.start(server, sandbox), "run it")
        methods = [r.get("method", "") for r in server.server_requests]
        self.assertTrue(any("requestApproval" in m for m in methods), f"server requests seen: {methods}")

    # ---- a turn as the app sees it

    def test_AS09_turn_delivers_the_answer(self):
        """A turn ends with `turn/completed` (status completed) and an `agentMessage` item holding the answer."""
        _a, _b, sandbox, server = self.setup(replies=[say("answer-6612")])
        thread = self.start(server, sandbox)
        turn = server.turn(thread, "hi")
        self.assertEqual(turn["status"], "completed")
        items = [n["item"] for n in server.notes("item/completed") if n.get("threadId") == thread]
        self.assertIn("answer-6612", [i.get("text") for i in items if i["type"] == "agentMessage"])

    def test_AS10_command_items_are_reported(self):
        """A shell call shows up as a `commandExecution` item with its command and output."""
        _a, _b, sandbox, server = self.setup(replies=[call("exec_command", {"cmd": "echo item-out-3390"}, "sh-1"), say("done")])
        thread = self.start(server, sandbox)
        server.turn(thread, "run it")
        commands = [n["item"] for n in server.notes("item/completed") if n["item"]["type"] == "commandExecution"]
        self.assertEqual(len(commands), 1, [n["item"]["type"] for n in server.notes("item/completed")])
        self.assertIn("item-out-3390", json.dumps(commands[0]))

    def test_AS11_token_usage_is_reported(self):
        """`thread/tokenUsage/updated` carries last.totalTokens and modelContextWindow (the context % in the composer)."""
        _a, _b, sandbox, server = self.setup()
        server.turn(self.start(server, sandbox), "hi")
        usage = server.wait_for("thread/tokenUsage/updated")
        self.assertEqual(usage["tokenUsage"]["last"]["totalTokens"], 128)
        self.assertGreater(usage["tokenUsage"]["modelContextWindow"], 0)

    def test_AS12_provider_error_fails_the_turn_with_a_message(self):
        """A provider error ends the turn as failed and the provider's message reaches the client."""
        _a, _b, sandbox, server = self.setup(default=lambda _b: http_error(400, "provider-said-no-2207", "invalid_request_error"))
        thread = self.start(server, sandbox)
        turn = server.turn(thread, "hi")
        self.assertEqual(turn["status"], "failed")
        self.assertIn("provider-said-no-2207", json.dumps(turn.get("error")) + json.dumps(server.notes("error")))

    def test_AS13_interrupt_stops_a_running_turn(self):
        """`turn/interrupt` ends a turn that is waiting on the provider."""
        def slow(_body):
            time.sleep(20)
            return say("too late")

        _a, _b, sandbox, server = self.setup(replies=[slow])
        thread = self.start(server, sandbox)
        server.request("turn/start", {"threadId": thread, "input": [{"type": "text", "text": "hi", "text_elements": []}]})
        started = server.wait_for("turn/started", lambda p: p.get("threadId") == thread)
        time.sleep(1)
        server.request("turn/interrupt", {"threadId": thread, "turnId": started["turn"]["id"]})
        done = server.wait_for("turn/completed", lambda p: p.get("threadId") == thread, timeout=15)
        self.assertEqual(done["turn"]["status"], "interrupted")

    # ---- sessions

    def test_AS14_thread_list_covers_every_provider(self):
        """`thread/list {modelProviders: []}` returns sessions of all providers, not only the default one."""
        _a, _b, sandbox, server = self.setup()
        first = self.start(server, sandbox)
        second = self.start(server, sandbox, modelProvider="b", model="b-model")
        server.turn(first, "one")
        server.turn(second, "two")
        listed = {t["id"]: t["modelProvider"] for t in server.request("thread/list", {"modelProviders": []})["data"]}
        self.assertEqual(listed.get(first), "a")
        self.assertEqual(listed.get(second), "b")

    def test_AS15_thread_list_filters_by_folder(self):
        """`thread/list {cwd}` returns only that folder's sessions (Chat history vs Code workspaces)."""
        _a, _b, sandbox, server = self.setup()
        chat = os.path.join(self.init["codexHome"], "chat")
        server.request("fs/createDirectory", {"path": chat, "recursive": True})
        in_work = self.start(server, sandbox)
        in_chat = server.request("thread/start", {"cwd": chat, **CHAT})["thread"]["id"]
        server.turn(in_work, "one")
        server.turn(in_chat, "two")
        ids = [t["id"] for t in server.request("thread/list", {"modelProviders": [], "cwd": chat})["data"]]
        self.assertEqual(ids, [in_chat])

    def test_AS16_thread_read_returns_the_turns(self):
        """`thread/read {includeTurns}` returns the user message and the answer of a past turn."""
        _a, _b, sandbox, server = self.setup(replies=[say("answer-1180")])
        thread = self.start(server, sandbox)
        server.turn(thread, "question-1179")
        turns = server.request("thread/read", {"threadId": thread, "includeTurns": True})["thread"]["turns"]
        self.assertEqual([i["type"] for i in turns[0]["items"]], ["userMessage", "agentMessage"])
        self.assertIn("answer-1180", json.dumps(turns))

    def test_AS17_resume_after_restart_keeps_the_conversation(self):
        """A session resumed by a new app-server process continues with its earlier history."""
        a, _b, sandbox, server = self.setup(replies=[say("answer-5001"), say("second")])
        thread = self.start(server, sandbox)
        server.turn(thread, "question-5000")
        server.close()
        again = sandbox.app_server()
        again.initialize()
        resumed = again.request("thread/resume", {"threadId": thread})
        self.assertEqual(resumed["thread"]["id"], thread)
        again.turn(thread, "follow-up")
        history = json.dumps(a.turns()[-1]["input"])
        self.assertIn("question-5000", history)
        self.assertIn("answer-5001", history)

    def reopened(self, **resume_params):
        """Record a Code session, restart the app-server, resume it with `resume_params`."""
        _a, _b, sandbox, server = self.setup()
        thread = self.start(server, sandbox)
        server.turn(thread, "hi")
        server.close()
        again = sandbox.app_server()
        again.initialize()
        return again.request("thread/resume", {"threadId": thread, **resume_params})

    def test_AS18_resume_with_code_permissions_is_writable(self):
        """After a restart, resuming with the Code permissions gives a workspace-write session again.

        The app must send them: `thread/resume` and `thread/fork` without `sandbox` take the
        config default for the folder (read-only unless it is a trusted project), not the
        sandbox the session was recorded with. hcodex-app omitted them until 20/11/2026.
        """
        resumed = self.reopened(**CODE)
        self.assertEqual(resumed["sandbox"]["type"], "workspaceWrite")
        self.assertEqual(resumed["approvalPolicy"], "on-request")

    def test_AS19_resume_with_chat_permissions_is_read_only(self):
        """After a restart, resuming with the Chat permissions gives a read-only session whatever was recorded."""
        resumed = self.reopened(**CHAT)
        self.assertEqual(resumed["sandbox"]["type"], "readOnly")
        self.assertEqual(resumed["approvalPolicy"], "never")

    def test_AS33_fork_with_code_permissions_is_writable(self):
        """Forking a Code session to another provider with the Code permissions keeps it writable."""
        _a, _b, sandbox, server = self.setup()
        thread = self.start(server, sandbox)
        server.turn(thread, "hi")
        fork = server.request("thread/fork", {"threadId": thread, "modelProvider": "b", "model": "b-model", **CODE})
        self.assertEqual(fork["sandbox"]["type"], "workspaceWrite")
        self.assertEqual(fork["approvalPolicy"], "on-request")

    def test_AS34_fork_with_chat_permissions_is_read_only(self):
        """Forking with the Chat permissions gives a read-only session."""
        _a, _b, sandbox, server = self.setup()
        thread = self.start(server, sandbox)
        server.turn(thread, "hi")
        fork = server.request("thread/fork", {"threadId": thread, "modelProvider": "b", "model": "b-model", **CHAT})
        self.assertEqual(fork["sandbox"]["type"], "readOnly")
        self.assertEqual(fork["approvalPolicy"], "never")

    # ---- providers and models

    def test_AS20_thread_start_on_a_chosen_provider(self):
        """`thread/start {modelProvider, model}` runs the session on that provider."""
        a, b, sandbox, server = self.setup()
        thread = self.start(server, sandbox, modelProvider="b", model="b-model")
        server.turn(thread, "hi")
        self.assertEqual([t["model"] for t in b.turns()], ["b-model"])
        self.assertEqual(a.turns(), [])

    def test_AS21_fork_to_another_provider_keeps_the_conversation(self):
        """`thread/fork {modelProvider, model}` continues on the other provider with the full history."""
        a, b, sandbox, server = self.setup(replies=[say("answer-from-a-3003")])
        thread = self.start(server, sandbox)
        server.turn(thread, "question-3002")
        fork = server.request("thread/fork", {"threadId": thread, "modelProvider": "b", "model": "b-model"})
        self.assertEqual(fork["modelProvider"], "b")
        self.assertNotEqual(fork["thread"]["id"], thread)
        server.turn(fork["thread"]["id"], "follow-up")
        self.assertEqual(len(b.turns()), 1)
        history = json.dumps(b.turns()[0]["input"])
        self.assertIn("question-3002", history)
        self.assertIn("answer-from-a-3003", history)
        self.assertEqual(len(a.turns()), 1)

    def test_AS22_per_turn_model_change(self):
        """`turn/start {model}` switches the model for that turn on the same provider."""
        a, _b, sandbox, server = self.setup()
        thread = self.start(server, sandbox)
        server.turn(thread, "one")
        server.turn(thread, "two", model="a-cheap")
        self.assertEqual([t["model"] for t in a.turns()], ["a-model", "a-cheap"])

    # ---- sub-agents

    def team(self, **start_params):
        script = scripted({"message": TASK})
        a = self.provider(models=("a-model", "a-cheap"), default=script)
        sandbox = self.sandbox(f'model_provider = "a"\nmodel = "a-model"\n{V2}\n' + provider_toml("a", a.base_url))
        server = sandbox.app_server()
        server.initialize()
        thread = server.request("thread/start", {"cwd": sandbox.cwd, **CODE, **start_params})["thread"]["id"]
        turn = server.turn(thread, ROOT, timeout=120)
        return a, server, thread, turn

    def test_AS23_sub_agent_shows_up_in_the_parent_thread(self):
        """A spawned sub-agent is announced in the parent thread, with the sub-agent's thread id."""
        _a, server, thread, turn = self.team()
        self.assertEqual(turn["status"], "completed")
        items = [n["item"] for n in server.notes("item/started") + server.notes("item/completed") if n.get("threadId") == thread]
        children = set()
        for item in items:
            if item["type"] == "subAgentActivity":
                children.add(item["agentThreadId"])
            elif item["type"] == "collabAgentToolCall":
                children.update(item.get("receiverThreadIds") or [])
        self.assertTrue(children, f"parent items: {sorted({i['type'] for i in items})}")
        self.assertNotIn(thread, children)

    def test_AS24_sub_agent_events_carry_its_own_thread_id(self):
        """The sub-agent's own items arrive as events with its thread id, so the app can show its stream."""
        _a, server, thread, _turn = self.team()
        others = {n.get("threadId") for n in server.notes("item/completed")} - {thread, None}
        self.assertTrue(others, "no item events from a second thread")

    def test_AS25_config_override_sets_the_sub_agent_model(self):
        """`config: {"agents.default_subagent_model": ...}` at `thread/start` picks the sub-agent's model."""
        a, _server, _thread, _turn = self.team(config={"agents.default_subagent_model": "a-cheap"})
        subs = [body for body in a.turns() if not is_root(body)]
        self.assertTrue(subs, "no sub-agent request")
        self.assertEqual(subs[0]["model"], "a-cheap")

    # ---- workspace pane

    def test_AS26_file_round_trip(self):
        """`fs/writeFile`, `fs/readFile` and `fs/readDirectory` work on the workspace (Files tab and editor)."""
        _a, _b, sandbox, server = self.setup()
        path = os.path.join(sandbox.cwd, "note.txt")
        server.request("fs/writeFile", {"path": path, "dataBase64": b64("hello from the app\n")})
        read = server.request("fs/readFile", {"path": path})
        self.assertEqual(base64.b64decode(read["dataBase64"]).decode(), "hello from the app\n")
        names = [e["fileName"] for e in server.request("fs/readDirectory", {"path": sandbox.cwd})["entries"]]
        self.assertIn("note.txt", names)

    def test_AS27_file_watch_reports_changes(self):
        """`fs/watch` reports a change in the workspace (`fs/changed`), which refreshes Changes and Files."""
        _a, _b, sandbox, server = self.setup()
        server.request("fs/watch", {"watchId": "w1", "path": sandbox.cwd})
        time.sleep(0.5)
        with open(os.path.join(sandbox.cwd, "changed.txt"), "w") as f:
            f.write("x")
        changed = server.wait_for("fs/changed", lambda p: p.get("watchId") == "w1", timeout=15)
        self.assertTrue(changed)

    def test_AS28_command_exec_returns_output(self):
        """`command/exec` runs a command in the workspace and returns exit code and stdout (the Changes tab's git diff)."""
        _a, _b, sandbox, server = self.setup()
        result = server.request(
            "command/exec",
            {"command": ["/bin/sh", "-c", "echo diff-out-8124; pwd"], "cwd": sandbox.cwd, "timeoutMs": 15000,
             "outputBytesCap": 2000000, "env": {"GIT_OPTIONAL_LOCKS": "0"}},
        )
        self.assertEqual(result["exitCode"], 0)
        self.assertIn("diff-out-8124", result["stdout"])

    def test_AS29_terminal_round_trip(self):
        """`process/spawn` with a pty echoes typed input back (`process/outputDelta`) and exits on kill."""
        _a, _b, sandbox, server = self.setup()
        handle = "term-1"
        server.request("process/spawn", {
            "command": ["/bin/sh"], "processHandle": handle, "cwd": sandbox.cwd, "tty": True, "streamStdin": True,
            "streamStdoutStderr": True, "outputBytesCap": None, "timeoutMs": None, "env": {"TERM": "xterm-256color"},
            "size": {"rows": 24, "cols": 80},
        })
        server.request("process/writeStdin", {"processHandle": handle, "deltaBase64": b64("echo TERM_$((1+1))_OK\n"), "closeStdin": False})
        server.wait_for(
            "process/outputDelta",
            lambda p: p.get("processHandle") == handle and b"TERM_2_OK" in base64.b64decode(p.get("deltaBase64", "")),
            timeout=10,
        )
        server.request("process/kill", {"processHandle": handle})
        server.wait_for("process/exited", lambda p: p.get("processHandle") == handle, timeout=10)

    def test_AS35_unsandboxed_command_can_query_launchd(self):
        """`command/exec` with `sandboxPolicy: dangerFullAccess` can ask launchd about a job (the Proxies page's status)."""
        _a, _b, _sandbox, server = self.setup()
        script = 'launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1 && echo loaded || echo "missing:$1"'
        result = server.request(
            "command/exec",
            {"command": ["/bin/sh", "-c", script, "proxy", "no.such.job.hcodex-test"], "timeoutMs": 10000,
             "outputBytesCap": 400000, "sandboxPolicy": {"type": "dangerFullAccess"}},
        )
        self.assertEqual(result["exitCode"], 0, result["stderr"])
        # The label arrives as a positional argument, not spliced into the script.
        self.assertEqual(result["stdout"].strip(), "missing:no.such.job.hcodex-test")
        listed = server.request(
            "command/exec",
            {"command": ["/bin/sh", "-c", 'launchctl print "gui/$(id -u)" | head -1'], "timeoutMs": 10000,
             "sandboxPolicy": {"type": "dangerFullAccess"}},
        )
        self.assertIn("gui/", listed["stdout"])

    # ---- extension pages

    def test_AS30_extension_pages_answer(self):
        """`skills/list`, `plugin/list` and `mcpServerStatus/list` answer (the app's read-only pages)."""
        _a, _b, sandbox, server = self.setup()
        self.assertIn("data", server.request("skills/list", {"cwds": [sandbox.cwd]}))
        self.assertIn("marketplaces", server.request("plugin/list", {}))
        self.assertIn("data", server.request("mcpServerStatus/list", {}))

    def test_AS31_user_skill_is_listed(self):
        """A skill in `<home>/skills/<name>/SKILL.md` appears in `skills/list`."""
        _a, _b, sandbox, _server = self.setup()
        sandbox.write("skills/probe-skill/SKILL.md", "---\nname: probe-skill\ndescription: Test skill for the harness tests.\n---\n\nDo nothing.\n")
        server = sandbox.app_server()
        server.initialize()
        listed = json.dumps(server.request("skills/list", {"cwds": [sandbox.cwd]}))
        self.assertIn("probe-skill", listed)

    def test_AS32_unknown_thread_is_an_error_not_a_hang(self):
        """Asking for a thread that does not exist answers with an error."""
        _a, _b, _sandbox, server = self.setup()
        with self.assertRaises(RpcError):
            server.request("thread/read", {"threadId": "00000000-0000-7000-8000-000000000000", "includeTurns": True}, timeout=15)
