#!/usr/bin/env python3
"""Compares two recorded live runs of the Claude provider.

Usage: compare.py <run A> <run B> [scenario...]

A run directory is what `scripts/claude-live/run` writes: `wire/` (one
`.meta.json` and `.wire.ndjson` per `claude` invocation), `events/` (the
neutral events and status of each scenario) and `work/<scenario>`. For each
scenario the report lists the differences in the neutral event sequence and,
per `claude` invocation, in its command line, environment, the lines the
provider wrote to stdin (order and JSON shape) and Claude's control traffic.
Model output is not compared: it differs between any two runs.
"""

import difflib
import glob
import json
import os
import re
import sys

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
NATIVE_ID = re.compile(r"\b(toolu|msg|req|srvtoolu|call)_[A-Za-z0-9]+")
VALUE_FLAGS = {
    "--output-format", "--input-format", "--thinking-display", "--setting-sources",
    "--permission-mode", "--model", "--session-id", "--resume", "--tools", "--add-dir",
    "--mcp-config", "--effort", "--permission-prompt-tool", "--thinking",
    "--fork-session", "--resume-session-at",
}
IGNORED_ENV = ("CODEWIDE_LIVE", "CARGO", "RUST")


class Run:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.label = os.path.basename(self.root)

    def text(self, value):
        value = value.replace(self.root, "<RUN>")
        value = UUID.sub("<uuid>", value)
        return NATIVE_ID.sub(lambda match: match.group(1) + "_<id>", value)

    def value(self, value):
        if isinstance(value, dict):
            return {key: self.value(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.value(item) for item in value]
        if isinstance(value, str):
            return self.text(value)
        return value

    def events(self, scenario):
        path = os.path.join(self.root, "events", f"{scenario}.events.ndjson")
        if not os.path.exists(path):
            return None
        with open(path) as lines:
            return [json.loads(line) for line in lines]

    def status(self, scenario):
        path = os.path.join(self.root, "events", f"{scenario}.status")
        if not os.path.exists(path):
            return "?"
        with open(path) as status:
            return status.read().strip()

    def scenarios(self):
        pattern = os.path.join(self.root, "events", "*.events.ndjson")
        return {os.path.basename(path)[: -len(".events.ndjson")] for path in glob.glob(pattern)}

    def invocations(self, scenario, events):
        """The scenario's sessions (by working directory) and the probes and
        helper commands started while it ran (by time)."""
        starts = [event["at"] for event in events if event["kind"] == "scenario.start"]
        ends = [event["at"] for event in events if event["kind"] == "scenario.end"]
        begin = min(starts) - 500_000_000
        end = max(ends or [max(event["at"] for event in events)]) + 500_000_000
        work = os.path.join(self.root, "work", scenario)
        found = []
        for meta_path in sorted(glob.glob(os.path.join(self.root, "wire", "*.meta.json"))):
            stamp = int(os.path.basename(meta_path).split("-")[0])
            with open(meta_path) as meta_file:
                meta = json.load(meta_file)
            argv = meta["argv"]
            session = any(arg == "--model" or arg.startswith("--model=") for arg in argv)
            own = meta["cwd"] == work or meta["cwd"].startswith(work + "/")
            if (session and not own) or (not session and not begin <= stamp <= end):
                continue
            wire_path = meta_path.replace(".meta.json", ".wire.ndjson")
            wire = []
            if os.path.exists(wire_path):
                with open(wire_path) as lines:
                    wire = [json.loads(line) for line in lines]
            if session:
                role = "session"
            elif argv[:1] in (["--version"], ["agents"]):
                role = "helper:" + " ".join(argv)
            else:
                role = "probe"
            found.append({"role": role, "meta": meta, "wire": wire})
        return found


def kind(direction, line):
    if not isinstance(line, dict):
        return f"{direction}:raw"
    line_type = line.get("type")
    if line_type == "control_request":
        return f"{direction}:control_request:{line.get('request', {}).get('subtype')}"
    if line_type == "control_response":
        return f"{direction}:control_response:{line.get('response', {}).get('subtype')}"
    if line_type in ("system", "result"):
        return f"{direction}:{line_type}:{line.get('subtype')}"
    return f"{direction}:{line_type}"


def written(run, invocation):
    """Every line the provider wrote, with the Claude request it answers."""
    requests = {
        entry["line"].get("request_id"): entry["line"]
        for entry in invocation["wire"]
        if isinstance(entry.get("line"), dict) and entry["line"].get("type") == "control_request"
    }
    lines = []
    for entry in invocation["wire"]:
        line = entry.get("line")
        if entry["dir"] != "in" or not isinstance(line, dict):
            continue
        answers = None
        if line.get("type") == "control_response":
            request = requests.get(line.get("response", {}).get("request_id"))
            if request:
                answers = request.get("request", {}).get("subtype")
        label = kind("in", line) + (f"<-{answers}" if answers else "")
        lines.append((label, run.value(line)))
    return lines


def claude_control(invocation):
    return [
        kind("out", entry["line"])
        for entry in invocation["wire"]
        if entry["dir"] == "out"
        and isinstance(entry.get("line"), dict)
        and entry["line"].get("type") in ("control_request", "control_response")
    ]


def lifecycle(invocation):
    return [
        entry["dir"] + (f":{entry.get('line')}" if entry["dir"] in ("signal", "exit") else "")
        for entry in invocation["wire"]
        if entry["dir"] in ("in-eof", "signal", "exit")
    ]


def neutral(events):
    sequence = []
    for entry in events:
        if entry["kind"] == "step":
            sequence.append(f"step:{entry['label']}")
        elif entry["kind"] == "event":
            event = entry["event"]
            event_type = event["type"]
            if event_type == "item.delta":
                continue
            if event_type in ("item.started", "item.completed"):
                sequence.append(f"{event_type}:{event['item']['type']}")
            elif event_type == "turn.completed":
                sequence.append(f"{event_type}:{event['turn']['status']}")
            elif event_type == "request.opened":
                sequence.append(f"{event_type}:{event['request']['type']}")
            else:
                sequence.append(event_type)
    collapsed = []
    for item in sequence:
        if collapsed and collapsed[-1][0] == item:
            collapsed[-1][1] += 1
        else:
            collapsed.append([item, 1])
    return [f"{item} x{count}" if count > 1 else item for item, count in collapsed]


def shape(value):
    """Key structure with scalar types; short strings kept."""
    if isinstance(value, dict):
        return {key: "<id>" if key == "request_id" else shape(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    if isinstance(value, str):
        return value if len(value) <= 60 else "<str>"
    if isinstance(value, bool) or value is None:
        return value
    return type(value).__name__


def canonical_argv(run, argv):
    """`--flag=value` tokens, so `--a=b` and `--a b` compare equal."""
    tokens, index = [], 0
    argv = [run.text(arg) for arg in argv]
    while index < len(argv):
        arg = argv[index]
        if arg in VALUE_FLAGS and index + 1 < len(argv):
            tokens.append(f"{arg}={argv[index + 1]}")
            index += 1
        else:
            tokens.append(arg)
        index += 1
    return tokens


def diff(left, right, labels, indent):
    lines = list(difflib.unified_diff(left, right, labels[0], labels[1], lineterm="", n=1))[2:]
    return [indent + line for line in lines]


def compare_invocations(a, b, left, right):
    labels = (a.label, b.label)
    out = []
    argv_a, argv_b = canonical_argv(a, left["meta"]["argv"]), canonical_argv(b, right["meta"]["argv"])
    if sorted(argv_a) != sorted(argv_b):
        out.append(f"    argv only {a.label}: {sorted(set(argv_a) - set(argv_b))}")
        out.append(f"    argv only {b.label}: {sorted(set(argv_b) - set(argv_a))}")
    env_a, env_b = left["meta"]["env"], right["meta"]["env"]
    for key in sorted(set(env_a) | set(env_b)):
        if key.startswith(IGNORED_ENV):
            continue
        value_a, value_b = env_a.get(key), env_b.get(key)
        value_a = a.text(value_a) if isinstance(value_a, str) else value_a
        value_b = b.text(value_b) if isinstance(value_b, str) else value_b
        if value_a != value_b:
            out.append(f"    env {key}: {a.label}={value_a!r} {b.label}={value_b!r}")
    lines_a, lines_b = written(a, left), written(b, right)
    sequence = diff([label for label, _ in lines_a], [label for label, _ in lines_b], labels, "      ")
    if sequence:
        out += ["    stdin sequence:"] + sequence
    seen = set()
    for (label_a, line_a), (label_b, line_b) in zip(lines_a, lines_b):
        if label_a != label_b or label_a in seen:
            continue
        shape_a = json.dumps(shape(line_a), indent=1, sort_keys=True).splitlines()
        shape_b = json.dumps(shape(line_b), indent=1, sort_keys=True).splitlines()
        if shape_a != shape_b:
            seen.add(label_a)
            out += [f"    shape of {label_a}:"] + diff(shape_a, shape_b, labels, "      ")
    control = diff(claude_control(left), claude_control(right), labels, "      ")
    if control:
        out += ["    claude control traffic:"] + control
    if lifecycle(left) != lifecycle(right):
        out.append(f"    lifecycle {a.label}: {lifecycle(left)} {b.label}: {lifecycle(right)}")
    return out or ["    same"]


def report(a, b, scenario):
    print(f"\n## {scenario}")
    events_a, events_b = a.events(scenario), b.events(scenario)
    if events_a is None or events_b is None:
        print("  no events in", a.label if events_a is None else b.label)
        return
    print(f"  status: {a.label}={a.status(scenario)} {b.label}={b.status(scenario)}")
    sequence = diff(neutral(events_a), neutral(events_b), (a.label, b.label), "    ")
    print("\n".join(["  neutral events:"] + sequence) if sequence else "  neutral events: same")
    runs_a, runs_b = a.invocations(scenario, events_a), b.invocations(scenario, events_b)
    for role in ("probe", "session"):
        left = [invocation for invocation in runs_a if invocation["role"] == role]
        right = [invocation for invocation in runs_b if invocation["role"] == role]
        for index in range(max(len(left), len(right))):
            print(f"  -- {role} #{index}")
            if index >= len(left) or index >= len(right):
                print("    only in", b.label if index >= len(left) else a.label)
                continue
            print("\n".join(compare_invocations(a, b, left[index], right[index])))


def main():
    if len(sys.argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    a, b = Run(sys.argv[1]), Run(sys.argv[2])
    if a.label == b.label:
        a.label, b.label = "A", "B"
    for scenario in sys.argv[3:] or sorted(a.scenarios() | b.scenarios()):
        report(a, b, scenario)
    return 0


sys.exit(main())
