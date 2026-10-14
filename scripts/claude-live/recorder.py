#!/usr/bin/env python3
"""Transparent recorder in front of the real `claude`.

`scripts/claude-live/run` copies this file to `<run>/bin/claude` with the
real executable and the output directory filled in. Per invocation it writes
`<out>/<stamp>.meta.json` (argv, cwd and the environment, secret-looking
variables redacted) and `<out>/<stamp>.wire.ndjson` (every stdin and stdout
line with its direction and time). It removes API-key variables, so a run
uses the user's Claude login and never an API key.
"""

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time

REAL = "__REAL__"
OUT = "__OUT__"
SECRET = re.compile(r"TOKEN|KEY|SECRET|PASS|AUTH|COOKIE|CREDENTIAL", re.I)
KEPT_PREFIXES = ("CLAUDE", "ANTHROPIC", "MCP", "DEBUG", "NODE", "DISABLE", "ENABLE", "OTEL", "USE_", "MAX_", "BASH_", "API_")


def environment_record():
    record = {}
    for name, value in sorted(os.environ.items()):
        if SECRET.search(name):
            record[name] = "<redacted>"
        elif name.startswith(KEPT_PREFIXES) or name in ("PATH", "HOME", "PWD", "SHELL", "TERM", "LANG"):
            record[name] = value
        else:
            record[name] = "<set>"
    return record


def main():
    os.makedirs(OUT, exist_ok=True)
    stamp = f"{time.time_ns()}-{os.getpid()}"
    base = os.path.join(OUT, stamp)
    with open(base + ".meta.json", "w") as meta:
        json.dump({"argv": sys.argv[1:], "cwd": os.getcwd(), "env": environment_record()}, meta, indent=1)
    environment = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    child = subprocess.Popen([REAL, *sys.argv[1:]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=environment)
    log = open(base + ".wire.ndjson", "w")
    lock = threading.Lock()
    started = time.monotonic()

    def write(direction, raw):
        line = raw.decode("utf-8", "replace").rstrip("\n")
        try:
            body = json.loads(line)
        except ValueError:
            body = line
        with lock:
            log.write(json.dumps({"t": round((time.monotonic() - started) * 1000), "dir": direction, "line": body}) + "\n")
            log.flush()

    def pump_in():
        try:
            for raw in iter(sys.stdin.buffer.readline, b""):
                write("in", raw)
                child.stdin.write(raw)
                child.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            with lock:
                log.write(json.dumps({"t": round((time.monotonic() - started) * 1000), "dir": "in-eof"}) + "\n")
            try:
                child.stdin.close()
            except OSError:
                pass

    def forward(signum, _frame):
        with lock:
            log.write(json.dumps({"t": round((time.monotonic() - started) * 1000), "dir": "signal", "line": signum}) + "\n")
            log.flush()
        try:
            child.send_signal(signum)
        except ProcessLookupError:
            pass

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, forward)
    threading.Thread(target=pump_in, daemon=True).start()
    out = sys.stdout.buffer
    for raw in iter(child.stdout.readline, b""):
        write("out", raw)
        try:
            out.write(raw)
            out.flush()
        except BrokenPipeError:
            break
    code = child.wait()
    with lock:
        log.write(json.dumps({"t": round((time.monotonic() - started) * 1000), "dir": "exit", "line": code}) + "\n")
        log.close()
    sys.exit(code if code >= 0 else 128 - code)


main()
