#!/usr/bin/env python3

import importlib.util
import json
from pathlib import Path
from time import perf_counter


TRANSPORT_HELPER = Path.home() / ".codex/tools/thread-title/rename-current-thread.py"


def main() -> None:
    print("thread-open benchmark: connecting", flush=True)
    spec = importlib.util.spec_from_file_location("codex_control", TRANSPORT_HELPER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load transport helper: {TRANSPORT_HELPER}")
    transport = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(transport)
    connection = transport.CodexWebSocket(transport.resolve_socket_path())
    request_id = 0

    def call(method: str, params: dict) -> dict:
        nonlocal request_id
        request_id += 1
        return transport.request(connection, request_id, method, params)

    try:
        call(
            "initialize",
            {
                "clientInfo": {
                    "name": "thread-open-benchmark",
                    "title": "Thread open benchmark",
                    "version": "1",
                },
                "capabilities": {"experimentalApi": True},
            },
        )
        connection.send_json({"method": "initialized", "params": {}})
        listed = call(
            "thread/list",
            {
                "limit": 5,
                "sortKey": "updated_at",
                "sortDirection": "desc",
                "useStateDbOnly": True,
            },
        )
        print(f"thread-open benchmark: {len(listed['data'])} samples", flush=True)
        rows = []
        for thread in listed["data"][:3]:
            thread_id = thread["id"]
            row = {
                "thread": thread_id[:8],
                "status": thread.get("status", {}).get("type"),
            }
            requests = [
                ("read", "thread/read", {"threadId": thread_id, "includeTurns": False}),
                (
                    "summaryCold",
                    "thread/turns/list",
                    {
                        "threadId": thread_id,
                        "cursor": None,
                        "limit": 6,
                        "sortDirection": "desc",
                        "itemsView": "summary",
                    },
                ),
                (
                    "summaryWarm",
                    "thread/turns/list",
                    {
                        "threadId": thread_id,
                        "cursor": None,
                        "limit": 6,
                        "sortDirection": "desc",
                        "itemsView": "summary",
                    },
                ),
            ]
            for label, method, params in requests:
                print(f"thread-open benchmark: {thread_id[:8]} {label}", flush=True)
                started = perf_counter()
                try:
                    result = call(method, params)
                    row[f"{label}Ms"] = round((perf_counter() - started) * 1000, 1)
                    row[f"{label}Bytes"] = len(json.dumps(result, separators=(",", ":")))
                except TimeoutError:
                    row[f"{label}Ms"] = round((perf_counter() - started) * 1000, 1)
                    row[f"{label}Error"] = "timeout"
                print(json.dumps(row), flush=True)
            rows.append(row)
        print(json.dumps(rows, indent=2))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
