"""RT: provider errors: what is retried, what is not, and that nothing hangs."""

import time

from harness_lib import HarnessTest, Reply, http_error, say, sse, stream_failed

FEW_RETRIES = "request_max_retries = 2\nstream_max_retries = 2\n"


def cut_stream() -> Reply:
    """HTTP 200 and a started response, then the stream ends without `response.completed`."""
    return Reply(200, sse([{"type": "response.created", "response": {"id": "resp-cut"}}]), "text/event-stream")


class Retry(HarnessTest):
    def run_with(self, replies, provider_extra=FEW_RETRIES, **kwargs):
        provider, sandbox = self.single(replies=replies, provider_extra=provider_extra, **kwargs)
        started = time.time()
        result = sandbox.exec("Reply with exactly: pong", timeout=120)
        return provider, result, time.time() - started

    def test_RT01_http_429_is_retried(self):
        """HTTP 429 from a third-party provider is retried and the turn then succeeds (codex itself gives up)."""
        provider, result, _took = self.run_with([http_error(429, "slow down", "rate_limit_error", {"retry-after": "1"}), say("pong")])
        self.assertEqual(result.last_message.strip(), "pong", result.output[-800:])
        self.assertEqual(len(provider.turns()), 2)

    def test_RT02_retry_after_is_honoured(self):
        """The retry after a 429 waits at least the provider's `Retry-After`."""
        provider, result, _took = self.run_with([http_error(429, "slow down", "rate_limit_error", {"retry-after": "2"}), say("pong")])
        posts = provider.posts()
        self.assertEqual(len(posts), 2, result.output[-800:])
        self.assertGreaterEqual(posts[1]["at"] - posts[0]["at"], 1.9)

    def test_RT03_endless_429_ends_with_an_error_not_a_hang(self):
        """A provider that always answers 429 makes the turn fail within the retry budget instead of hanging."""
        provider, result, took = self.run_with([], provider_extra="request_max_retries = 1\nstream_max_retries = 1\n",
                                               default=lambda _b: http_error(429, "slow down", "rate_limit_error", {"retry-after": "1"}))
        self.assertNotEqual(result.last_message.strip(), "pong")
        self.assertLess(took, 100, "the turn did not give up")
        self.assertGreaterEqual(len(provider.turns()), 2, "429 was not retried at all")
        self.assertLessEqual(len(provider.turns()), 12, "far more retries than configured")
        self.assertRegex(result.output, r"(?i)429|rate limit|too many requests|slow down")

    def test_RT04_stream_overload_is_retried(self):
        """`server_is_overloaded` reported inside the stream is retried at turn level, not shown as a finished turn."""
        provider, result, _took = self.run_with([stream_failed("server_is_overloaded", "model busy"), say("pong")])
        self.assertEqual(result.last_message.strip(), "pong", result.output[-800:])
        self.assertEqual(len(provider.turns()), 2)

    def test_RT05_stream_rate_limit_is_retried(self):
        """A rate limit reported inside the stream is retried at turn level."""
        provider, result, _took = self.run_with(
            [stream_failed("rate_limit_exceeded", "Rate limit reached. Please try again in 1s."), say("pong")]
        )
        self.assertEqual(result.last_message.strip(), "pong", result.output[-800:])
        self.assertEqual(len(provider.turns()), 2)

    def test_RT06_http_400_is_not_retried(self):
        """A 400 (bad request, e.g. the proxy rejects the client) fails at once: one request, error shown."""
        provider, result, took = self.run_with([], default=lambda _b: http_error(400, "this client is not supported", "invalid_request_error"))
        self.assertEqual(len(provider.turns()), 1)
        self.assertLess(took, 30)
        self.assertIn("this client is not supported", result.output)
        self.assertNotEqual(result.returncode, 0)

    def test_RT07_http_500_is_retried(self):
        """A 500 from the provider is retried and the turn then succeeds."""
        provider, result, _took = self.run_with([http_error(500, "upstream exploded", "server_error"), say("pong")])
        self.assertEqual(result.last_message.strip(), "pong", result.output[-800:])
        self.assertEqual(len(provider.turns()), 2)

    def test_RT08_stream_cut_before_completion_is_retried(self):
        """A stream that ends before `response.completed` (proxy dropped the connection) is retried."""
        provider, result, _took = self.run_with([cut_stream(), say("pong")])
        self.assertEqual(result.last_message.strip(), "pong", result.output[-800:])
        self.assertEqual(len(provider.turns()), 2)

    def test_RT09_http_401_is_not_retried_forever(self):
        """A 401 (bad or missing key) ends the turn with the provider's message, without a retry storm."""
        provider, result, took = self.run_with([], default=lambda _b: http_error(401, "invalid api key", "authentication_error"))
        self.assertLessEqual(len(provider.turns()), 3)
        self.assertLess(took, 60)
        self.assertNotEqual(result.returncode, 0)

    def dead_provider(self):
        provider, sandbox = self.single(provider_extra="request_max_retries = 1\nstream_max_retries = 1\n")
        provider.close()
        return sandbox

    def test_RT10_provider_down_is_reported_while_waiting(self):
        """A provider that refuses connections is reported ("Reconnecting...") instead of a silent wait.

        Upstream keeps waiting for the network by default (`unbounded_connection_retries`),
        so the turn itself does not end; what must hold is that the user is told why.
        """
        result = self.dead_provider().exec("Reply with exactly: pong", timeout=20)
        self.assertIn("Reconnecting", result.output)

    def test_RT11_provider_down_fails_fast_when_unbounded_retries_are_off(self):
        """With `features.unbounded_connection_retries=false` a dead provider ends the turn with an error."""
        started = time.time()
        result = self.dead_provider().exec(
            "Reply with exactly: pong", "-c", "features.unbounded_connection_retries=false", timeout=90
        )
        self.assertNotEqual(result.returncode, 0, result.output[-600:])
        self.assertLess(time.time() - started, 60)
        self.assertIn("Connection failed", result.output)
