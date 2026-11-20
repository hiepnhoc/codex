"""Shared pieces of the hcodex harness tests.

Nothing here needs the network or a real provider:

- `MockProvider`  a scriptable stand-in for an OpenAI-compatible provider (GET /models,
                  POST /responses as SSE) that records every request it receives
- `Sandbox`       a throwaway hcodex home + working directory, with `exec()` and `app_server()`
- `AppServer`     a JSON-RPC client for `hcodex app-server` over stdio

The binary under test comes from $HCODEX_BIN, else `hcodex` on PATH, else ~/.hcodex/bin/hcodex.
"""

from __future__ import annotations

import http.server
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import unittest

BIN = (
    os.environ.get("HCODEX_BIN")
    or shutil.which("hcodex")
    or os.path.expanduser("~/.hcodex/bin/hcodex")
)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
TURN_TIMEOUT = float(os.environ.get("HCODEX_TEST_TIMEOUT", "60"))


# ------------------------------------------------------------------ provider replies


class Reply:
    def __init__(self, status: int, body: bytes, content_type: str, headers: dict | None = None):
        self.status = status
        self.body = body
        self.content_type = content_type
        self.headers = headers or {}


def sse(events: list[dict]) -> bytes:
    """Encode Responses API events the way a provider streams them."""
    out = []
    for event in events:
        out.append(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n")
    return "".join(out).encode()


USAGE = {
    "input_tokens": 120,
    "input_tokens_details": None,
    "output_tokens": 8,
    "output_tokens_details": None,
    "total_tokens": 128,
}


def _stream(items: list[dict], response_id: str = "resp-1") -> Reply:
    events = [{"type": "response.created", "response": {"id": response_id}}]
    events += [{"type": "response.output_item.done", "item": item} for item in items]
    events.append({"type": "response.completed", "response": {"id": response_id, "usage": USAGE}})
    return Reply(200, sse(events), "text/event-stream")


def message_item(text: str) -> dict:
    return {
        "type": "message",
        "role": "assistant",
        "id": "msg-1",
        "content": [{"type": "output_text", "text": text}],
    }


def call_item(name: str, arguments: dict, call_id: str = "call-1") -> dict:
    return {
        "type": "function_call",
        "call_id": call_id,
        "name": name,
        "arguments": json.dumps(arguments),
    }


def say(text: str) -> Reply:
    """The model answers with plain text and ends the turn."""
    return _stream([message_item(text)])


def call(name: str, arguments: dict, call_id: str = "call-1") -> Reply:
    """The model calls one function tool."""
    return _stream([call_item(name, arguments, call_id)])


def stream_failed(code: str, message: str) -> Reply:
    """HTTP 200, then the stream reports a failed response (how proxies report overload)."""
    event = {
        "type": "response.failed",
        "response": {"id": "resp-failed", "error": {"code": code, "message": message}},
    }
    return Reply(200, sse([event]), "text/event-stream")


def http_error(status: int, message: str, error_type: str = "error", headers: dict | None = None) -> Reply:
    body = json.dumps({"error": {"message": message, "type": error_type, "code": error_type}})
    return Reply(status, body.encode(), "application/json", headers)


# ------------------------------------------------------------------ the stand-in provider


class MockProvider:
    """An OpenAI-compatible provider on 127.0.0.1 that plays back scripted replies.

    `models` are ids, or full `/models` entries (dicts) when a test needs extra metadata.
    `replies` are used in order, one per POST /responses; each is a `Reply` or a function
    `(request_body) -> Reply`. When they run out, `default` answers (plain "pong").
    """

    def __init__(self, models=("mock-model",), replies=(), default=None, models_status: int = 200):
        self.models = list(models)
        self.replies = list(replies)
        self.default = default or (lambda _body: say("pong"))
        self.models_status = models_status
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        provider = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                pass

            def _send(self, reply: Reply):
                self.send_response(reply.status)
                self.send_header("content-type", reply.content_type)
                self.send_header("content-length", str(len(reply.body)))
                for key, value in reply.headers.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(reply.body)

            def _record(self, method: str, body):
                headers = {k.lower(): v for k, v in self.headers.items()}
                with provider._lock:
                    provider.requests.append(
                        {"method": method, "path": self.path, "headers": headers, "body": body, "at": time.time()}
                    )

            def do_GET(self):
                self._record("GET", None)
                if self.path.split("?")[0].endswith("/models"):
                    if provider.models_status != 200:
                        self._send(http_error(provider.models_status, "models unavailable"))
                        return
                    data = [
                        m if isinstance(m, dict) else {"id": m, "object": "model", "owned_by": "mock"}
                        for m in provider.models
                    ]
                    self._send(Reply(200, json.dumps({"object": "list", "data": data}).encode(), "application/json"))
                else:
                    self._send(http_error(404, "not found"))

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("content-length", 0)))
                try:
                    body = json.loads(raw)
                except ValueError:
                    body = {"_unparsed": raw[:200].decode("latin-1")}
                self._record("POST", body)
                if not self.path.split("?")[0].endswith("/responses"):
                    self._send(http_error(404, "not found"))
                    return
                with provider._lock:
                    reply = provider.replies.pop(0) if provider.replies else provider.default
                self._send(reply(body) if callable(reply) else reply)

        class Server(http.server.ThreadingHTTPServer):
            daemon_threads = True

            def handle_error(self, _request, _client_address):
                pass  # hcodex dropping a connection (interrupt, retry) is not worth a traceback

        self._server = Server(("127.0.0.1", 0), Handler)
        self.base_url = f"http://127.0.0.1:{self._server.server_address[1]}/v1"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def close(self):
        self._server.shutdown()
        self._server.server_close()

    def turns(self) -> list[dict]:
        """Bodies of the POST /responses requests, in arrival order."""
        with self._lock:
            return [r["body"] for r in self.requests if r["method"] == "POST" and r["path"].endswith("/responses")]

    def posts(self) -> list[dict]:
        with self._lock:
            return [r for r in self.requests if r["method"] == "POST"]

    def gets(self, suffix: str = "/models") -> list[dict]:
        with self._lock:
            return [r for r in self.requests if r["method"] == "GET" and r["path"].split("?")[0].endswith(suffix)]


# ------------------------------------------------------------------ reading a recorded request


def system_texts(body: dict) -> list[str]:
    """Every piece of system-level text in a request: `instructions`, then developer/system items."""
    texts = [body.get("instructions") or ""]
    for item in body.get("input", []):
        if isinstance(item, dict) and item.get("role") in ("developer", "system"):
            texts.append(item_text(item))
    return [t for t in texts if t.strip()]


def item_text(item: dict) -> str:
    content = item.get("content")
    if isinstance(content, str):
        return content
    return "".join(part.get("text", "") for part in content or [] if isinstance(part, dict))


def user_texts(body: dict) -> list[str]:
    return [item_text(i) for i in body.get("input", []) if isinstance(i, dict) and i.get("role") == "user"]


def tool_names(body: dict) -> list[str]:
    return [t.get("name", "") for t in body.get("tools", []) if isinstance(t, dict)]


def find_tool(body: dict, *candidates: str) -> str | None:
    """The first tool the request offers whose name is one of `candidates`."""
    names = tool_names(body)
    for name in candidates:
        if name in names:
            return name
    return None


def output_for(body: dict, call_id: str) -> str | None:
    """The tool output hcodex sent back for `call_id`, as text."""
    for item in body.get("input", []):
        if isinstance(item, dict) and item.get("type") == "function_call_output" and item.get("call_id") == call_id:
            output = item.get("output")
            if isinstance(output, str):
                return output
            return json.dumps(output)
    return None


# ------------------------------------------------------------------ a throwaway home


def provider_toml(provider_id: str, base_url: str, extra: str = "") -> str:
    return (
        f"[model_providers.{provider_id}]\n"
        f'name = "{provider_id}"\n'
        f'base_url = "{base_url}"\n'
        'wire_api = "responses"\n'
        "requires_openai_auth = false\n"
        f"{extra}\n"
    )


class ExecResult:
    def __init__(self, returncode: int, output: str, last_message: str):
        self.returncode = returncode
        self.output = output
        self.last_message = last_message


class Sandbox:
    """A throwaway hcodex home and working directory. Never touches ~/.hcodex or ~/.codex."""

    def __init__(self, config: str = ""):
        self.root = tempfile.mkdtemp(prefix="hcodex-test-")
        self.home = os.path.join(self.root, "home")
        self.cwd = os.path.join(self.root, "work")
        os.makedirs(self.home)
        os.makedirs(self.cwd)
        self.write_config(config)
        self._servers: list[AppServer] = []

    def write_config(self, config: str):
        with open(os.path.join(self.home, "config.toml"), "w") as f:
            f.write(config)

    def write(self, relative: str, text: str, base: str | None = None) -> str:
        path = os.path.join(base or self.home, relative)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
        return path

    def env(self, extra: dict | None = None) -> dict:
        env = dict(os.environ)
        # The office LAN sets an HTTP proxy that answers 503 for 127.0.0.1.
        env["NO_PROXY"] = env["no_proxy"] = "127.0.0.1,localhost"
        for name in ("HCODEX_PROXY_URL", "HCODEX_PROXY_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"):
            env.pop(name, None)
        env["CODEX_HOME"] = self.home
        for key, value in (extra or {}).items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        return env

    def run(self, *args: str, env: dict | None = None, timeout: float = TURN_TIMEOUT, cwd: str | None = None):
        """Run `hcodex <args>`; returns (returncode, combined output without colour codes)."""
        try:
            done = subprocess.run(
                [BIN, *args],
                cwd=cwd or self.cwd,
                env=self.env(env),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=timeout,
            )
            return done.returncode, ANSI.sub("", done.stdout.decode("utf-8", "replace"))
        except subprocess.TimeoutExpired as e:
            return 124, ANSI.sub("", (e.stdout or b"").decode("utf-8", "replace")) + f"\n[timed out after {timeout}s]"

    def exec(self, prompt: str, *args: str, env: dict | None = None, timeout: float = TURN_TIMEOUT) -> ExecResult:
        """One non-interactive turn: `hcodex exec`."""
        last = os.path.join(self.root, "last-message.txt")
        if os.path.exists(last):
            os.remove(last)
        code, output = self.run(
            "exec", "--skip-git-repo-check", "-o", last, *args, prompt, env=env, timeout=timeout
        )
        message = ""
        if os.path.exists(last):
            with open(last) as f:
                message = f.read()
        return ExecResult(code, output, message)

    def app_server(self, env: dict | None = None) -> "AppServer":
        server = AppServer(self.env(env), self.cwd)
        self._servers.append(server)
        return server

    def close(self):
        for server in self._servers:
            server.close()
        shutil.rmtree(self.root, ignore_errors=True)


# ------------------------------------------------------------------ app-server client


class RpcError(Exception):
    pass


class AppServer:
    """`hcodex app-server` over stdio, speaking the JSON-RPC the desktop app uses."""

    def __init__(self, env: dict, cwd: str):
        self.proc = subprocess.Popen(
            [BIN, "app-server"], cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        self._next_id = 0
        self._results: dict[int, dict] = {}
        self.notifications: list[dict] = []
        self.server_requests: list[dict] = []
        self._changed = threading.Condition()
        self._write_lock = threading.Lock()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            try:
                message = json.loads(line)
            except ValueError:
                continue
            with self._changed:
                if "id" in message and "method" in message:
                    # Server asking the client (approvals): accept, like the app's Approve button.
                    self.server_requests.append(message)
                    self._send({"id": message["id"], "result": {"decision": "accept"}})
                elif "id" in message:
                    self._results[message["id"]] = message
                else:
                    self.notifications.append(message)
                self._changed.notify_all()
        with self._changed:
            self._changed.notify_all()

    def _send(self, message: dict):
        with self._write_lock:
            self.proc.stdin.write((json.dumps(message) + "\n").encode())
            self.proc.stdin.flush()

    def request(self, method: str, params: dict | None = None, timeout: float = 30):
        self._next_id += 1
        request_id = self._next_id
        self._send({"id": request_id, "method": method, "params": params or {}})
        deadline = time.time() + timeout
        with self._changed:
            while request_id not in self._results:
                remaining = deadline - time.time()
                if remaining <= 0 or self.proc.poll() is not None:
                    raise RpcError(f"{method}: no answer within {timeout}s (app-server exit: {self.proc.poll()})")
                self._changed.wait(min(remaining, 0.5))
            message = self._results.pop(request_id)
        if "error" in message:
            raise RpcError(f"{method}: {json.dumps(message['error'])}")
        return message.get("result")

    def initialize(self) -> dict:
        result = self.request(
            "initialize",
            {
                "clientInfo": {"name": "harness-tests", "title": "harness tests", "version": "0"},
                "capabilities": {"experimentalApi": True},
            },
        )
        self._send({"method": "initialized"})
        return result

    def wait_for(self, method: str, predicate=None, timeout: float = TURN_TIMEOUT, start: int = 0) -> dict:
        """Params of the first notification `method` (from index `start`) that satisfies `predicate`."""
        deadline = time.time() + timeout
        seen = start
        with self._changed:
            while True:
                while seen < len(self.notifications):
                    note = self.notifications[seen]
                    seen += 1
                    if note.get("method") == method and (predicate is None or predicate(note.get("params", {}))):
                        return note.get("params", {})
                remaining = deadline - time.time()
                if remaining <= 0:
                    methods = sorted({n.get("method", "") for n in self.notifications})
                    raise RpcError(f"no `{method}` notification within {timeout}s; saw: {', '.join(methods)}")
                self._changed.wait(min(remaining, 0.5))

    def notes(self, method: str) -> list[dict]:
        with self._changed:
            return [n.get("params", {}) for n in self.notifications if n.get("method") == method]

    def turn(self, thread_id: str, text: str, timeout: float = TURN_TIMEOUT, **params) -> dict:
        """Send one user message and wait until that thread's turn completes; returns the turn."""
        start = len(self.notifications)
        self.request(
            "turn/start",
            {"threadId": thread_id, "input": [{"type": "text", "text": text, "text_elements": []}], **params},
        )
        done = self.wait_for("turn/completed", lambda p: p.get("threadId") == thread_id, timeout, start)
        return done.get("turn", {})

    def close(self):
        if self.proc.poll() is None:
            self.proc.kill()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        for pipe in (self.proc.stdin, self.proc.stdout):
            try:
                pipe.close()
            except OSError:
                pass


# ------------------------------------------------------------------ base test case


class HarnessTest(unittest.TestCase):
    """Base class: helpers that clean up after themselves."""

    maxDiff = None

    def provider(self, **kwargs) -> MockProvider:
        provider = MockProvider(**kwargs)
        self.addCleanup(provider.close)
        return provider

    def sandbox(self, config: str = "") -> Sandbox:
        sandbox = Sandbox(config)
        self.addCleanup(sandbox.close)
        return sandbox

    def single(self, model: str = "mock-model", provider_extra: str = "", config_extra: str = "", **provider_kwargs):
        """One mock provider wired up as the configured provider `mock`."""
        provider_kwargs.setdefault("models", (model,))
        provider = self.provider(**provider_kwargs)
        config = (
            f'model_provider = "mock"\nmodel = "{model}"\n{config_extra}\n'
            + provider_toml("mock", provider.base_url, provider_extra)
        )
        return provider, self.sandbox(config)
