"""A minimal MCP server over stdio with one tool, `echo`, for the harness tests."""

import json
import sys

TOOL = {
    "name": "echo",
    "description": "Return the given text unchanged.",
    "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
}


def answer(request_id, result):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    try:
        message = json.loads(line)
    except ValueError:
        continue
    method, request_id = message.get("method"), message.get("id")
    if request_id is None:
        continue  # notification
    if method == "initialize":
        version = message.get("params", {}).get("protocolVersion", "2025-06-18")
        answer(request_id, {"protocolVersion": version, "capabilities": {"tools": {}}, "serverInfo": {"name": "echo", "version": "0"}})
    elif method == "tools/list":
        answer(request_id, {"tools": [TOOL]})
    elif method == "tools/call":
        text = message.get("params", {}).get("arguments", {}).get("text", "")
        answer(request_id, {"content": [{"type": "text", "text": f"echo:{text}"}], "isError": False})
    else:
        answer(request_id, {})
