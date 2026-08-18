#!/usr/bin/env python3

import collections
import importlib.util
import json
import os
from pathlib import Path


HELPER_PATH = Path.home() / ".codex/tools/thread-title/rename-current-thread.py"


def load_transport():
    spec = importlib.util.spec_from_file_location("codex_ws", HELPER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load transport helper: {HELPER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def safe_shape(value, key=None, depth=0):
    if depth > 7:
        return "<max-depth>"
    if isinstance(value, dict):
        return {
            child_key: safe_shape(child_value, child_key, depth + 1)
            for child_key, child_value in value.items()
        }
    if isinstance(value, list):
        if not value:
            return []
        return [safe_shape(value[0], key, depth + 1), f"<count:{len(value)}>"]
    if isinstance(value, str):
        if key in {
            "type",
            "status",
            "phase",
            "source",
            "kind",
            "tool",
            "server",
            "modelProvider",
            "cliVersion",
            "itemsView",
        }:
            return value
        if key and key.lower().endswith("id"):
            return "<id>"
        return f"<str:{len(value)}>"
    return value


def main():
    thread_id = os.environ.get("CODEX_THREAD_ID")
    if not thread_id:
        raise RuntimeError("CODEX_THREAD_ID is not set")

    transport = load_transport()
    connection = transport.CodexWebSocket(transport.resolve_socket_path())

    def call(request_id, method, params):
        return transport.request(connection, request_id, method, params)

    try:
        initialized = call(
            1,
            "initialize",
            {
                "clientInfo": {
                    "name": "thread-wire-inspector",
                    "title": "Thread wire inspector",
                    "version": "1",
                },
                "capabilities": {"experimentalApi": True},
            },
        )
        connection.send_json({"method": "initialized", "params": {}})

        listed = call(
            2,
            "thread/list",
            {"limit": 2, "sortKey": "updated_at", "sortDirection": "desc"},
        )
        read = call(
            3,
            "thread/read",
            {"threadId": thread_id, "includeTurns": True},
        )
        thread = read["thread"]

        item_counts = collections.Counter()
        item_keys = collections.defaultdict(set)
        samples = {}
        turn_statuses = collections.Counter()
        for turn in thread.get("turns", []):
            turn_statuses[turn.get("status")] += 1
            for item in turn.get("items", []):
                item_type = item.get("type", "<missing>")
                item_counts[item_type] += 1
                item_keys[item_type].update(item.keys())
                samples.setdefault(item_type, safe_shape(item))

        optional = {}
        requests = [
            (
                4,
                "thread/turns/list",
                {
                    "threadId": thread_id,
                    "limit": 2,
                    "sortDirection": "desc",
                    "itemsView": "full",
                },
            ),
            (
                5,
                "thread/items/list",
                {
                    "threadId": thread_id,
                    "limit": 3,
                    "sortDirection": "asc",
                },
            ),
        ]
        for request_id, method, params in requests:
            try:
                result = call(request_id, method, params)
                optional[method] = {
                    "supported": True,
                    "shape": safe_shape(result),
                }
            except Exception as error:
                optional[method] = {
                    "supported": False,
                    "error": str(error),
                }

        rollout = None
        rollout_path = thread.get("path")
        if rollout_path:
            envelope_counts = collections.Counter()
            payload_type_counts = collections.defaultdict(collections.Counter)
            payload_keys = collections.defaultdict(set)
            payload_keys_by_type = collections.defaultdict(set)
            with open(rollout_path, encoding="utf-8") as stream:
                for line in stream:
                    record = json.loads(line)
                    envelope_type = record.get("type", "<missing>")
                    payload = record.get("payload")
                    envelope_counts[envelope_type] += 1
                    if not isinstance(payload, dict):
                        continue
                    payload_keys[envelope_type].update(payload.keys())
                    payload_type = payload.get("type")
                    if isinstance(payload_type, str):
                        payload_type_counts[envelope_type][payload_type] += 1
                        payload_keys_by_type[(envelope_type, payload_type)].update(
                            payload.keys()
                        )
            rollout = {
                "envelopeCounts": dict(envelope_counts),
                "payloadTypeCounts": {
                    key: dict(value)
                    for key, value in sorted(payload_type_counts.items())
                },
                "payloadKeys": {
                    key: sorted(value) for key, value in sorted(payload_keys.items())
                },
                "payloadKeysByType": {
                    f"{envelope_type}:{payload_type}": sorted(value)
                    for (envelope_type, payload_type), value in sorted(
                        payload_keys_by_type.items()
                    )
                },
            }

        output = {
            "initialize": safe_shape(initialized),
            "threadList": {
                "responseKeys": sorted(listed.keys()),
                "returned": len(listed.get("data", [])),
                "threadKeys": (
                    sorted(listed["data"][0].keys()) if listed.get("data") else []
                ),
                "sample": (
                    safe_shape(listed["data"][0]) if listed.get("data") else None
                ),
            },
            "threadRead": {
                "responseKeys": sorted(read.keys()),
                "threadKeys": sorted(thread.keys()),
                "status": thread.get("status"),
                "source": thread.get("source"),
                "cliVersion": thread.get("cliVersion"),
                "turnCount": len(thread.get("turns", [])),
                "turnStatuses": dict(turn_statuses),
                "turnKeys": (
                    sorted(thread["turns"][0].keys())
                    if thread.get("turns")
                    else []
                ),
                "itemCounts": dict(item_counts),
                "itemKeysByType": {
                    key: sorted(value) for key, value in sorted(item_keys.items())
                },
                "sampleShapesByType": samples,
            },
            "experimentalPagination": optional,
            "persistedRollout": rollout,
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
