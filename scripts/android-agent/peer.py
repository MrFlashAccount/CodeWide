"""Short-lived local Companion with synthetic Codex events and persistent test identity."""

import json
import os
import shlex
import subprocess
import tempfile
from contextlib import ExitStack, contextmanager
from pathlib import Path

from lab import HERE, LAB, PEER, ROOT, SERIAL, SDK, adb, click, device, run, screen, wait_for


@contextmanager
def fixture_peer():
    sd = LAB / "notification-peer"
    for name in ["data", "config", "codex", "claude"]:
        (sd / name).mkdir(parents=True, exist_ok=True)
    binary = os.environ.get("CODEWIDE_TEST_COMPANION")
    if not binary:
        with (LAB / "logs/companion-build.log").open("w") as log:
            subprocess.run(
                ["cargo", "build", "--locked", "-p", "codewide-companion"],
                cwd=ROOT,
                stdout=log,
                stderr=subprocess.STDOUT,
                check=True,
            )
        target = Path(os.environ.get("CARGO_TARGET_DIR", ROOT / "target"))
        binary = str((ROOT / target / "debug/codewide-companion").resolve())
    env = {
        "PATH": "/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "HOME": str(Path.home()),
        "XDG_STATE_HOME": str(sd / "data"),
        "XDG_CONFIG_HOME": str(sd / "config"),
        "CLAUDE_CONFIG_DIR": str(sd / "claude"),
    }
    token = sd / "token"
    if not token.exists():
        run(binary, "create-token", "--token-file", token, env=env)
    with tempfile.TemporaryDirectory(prefix="cw-peer-") as tmp, ExitStack() as stack:
        base = Path(tmp)
        events, upstream, control = (base / s for s in ["events.sock", "codex.sock", "control.sock"])

        def start(args, child_env, name):
            log = stack.enter_context((LAB / "logs" / name).open("w"))
            p = subprocess.Popen(
                args, cwd=ROOT, env=child_env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT
            )

            def stop():
                p.terminate()
                try:
                    p.wait(8)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait()

            stack.callback(stop)
            return p

        start(["node", HERE / "fixture.mjs", upstream, events], os.environ, "provider.log")
        wait_for("fixture socket", upstream.is_socket)
        companion = start(
            [
                binary,
                "serve",
                "--enable-mutations",
                "--listen",
                f"127.0.0.1:{PEER}",
                "--control-endpoint",
                control,
                "--state",
                sd / "index.redb",
                "--token-file",
                token,
                "--app-server-socket",
                upstream,
                "--codex-home",
                sd / "codex",
                "--device-registry",
                sd / "devices.json",
                "--data-dir",
                sd / "data",
                "--identity-dir",
                sd / "identity",
            ],
            env,
            "peer.log",
        )

        def ready():
            if companion.poll() is not None:
                raise ValueError("Test Companion exited. See peer.log")
            return run("curl", "-fsS", "--unix-socket", events, "http://localhost/ready") == "ready"

        wait_for("provider connected", ready, 30)
        adb("reverse", f"tcp:{PEER}", f"tcp:{PEER}")
        yield (
            events,
            lambda: json.loads(
                run(
                    binary,
                    "pair",
                    "--json",
                    "--control-endpoint",
                    control,
                    "--token-file",
                    token,
                    env=dict(
                        env,
                        CODEWIDE_SERVER_NAME="Notification Lab",
                        CODEWIDE_PUBLIC_ENDPOINT=f"ws://127.0.0.1:{PEER}/v1/sync",
                    ),
                )
            )["pairingPayload"],
        )


def pair_if_needed(invitation):
    if "Thread list menu" in screen() or "Back to settings" in screen():
        return
    device("find", "Connect a server", "click", "--first")
    click("button", "Open manual server setup", scroll=True)
    payload = json.loads(invitation())
    for placeholder, field in [
        ("Home workstation", "displayName"),
        ("wss://host.example/v1/sync", "endpoint"),
        ("Paste token", "pairingToken"),
        ("sha256/base64…", "tlsPinSha256"),
    ]:
        device("find", placeholder, "click", "--first")
        # Send the one-use secret over stdin, keeping it out of host argv and Callstack logs.
        subprocess.run(
            [SDK / "platform-tools/adb", "-s", SERIAL, "shell"],
            text=True,
            input=shlex.join(["input", "text", payload[field].replace(" ", "%s")]) + "\n",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
    device("find", "Connect server manually", "click", "--first")
    wait_for("paired workspace", lambda: "Thread list menu" in screen())
