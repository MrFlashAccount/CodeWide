#!/usr/bin/env python3
"""Exercise a held disposable VM using real SSH/PTTY and a real Companion client.

Credentials remain inside the VM/runtime. Output contains only scenario results,
versions and SHA-256 hashes. Never point this at a working Relay or account.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shlex
import struct
import subprocess
import termios
import time
import tty
import unicodedata

CSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
ROOT = Path(__file__).resolve().parents[2]


class Terminal:
    def __init__(self, command):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.execvp(command[0], command)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        # Docker exec transports SSH through pipes, so no local SSH TTY owner
        # switches this PTY to raw mode. Forward cursor reports immediately.
        tty.setraw(self.fd)
        self.output = b""
        self.done = False

    def pump(self):
        if select.select([self.fd], [], [], 0.1)[0]:
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                return
            self.output += data
            if b"\x1b[6n" in data:
                os.write(self.fd, b"\x1b[1;1R")

    def screen(self):
        # Interpret cursor updates: Ratatui publishes changed cells, not complete lines.
        cells = [[" "] * 80 for _ in range(24)]
        row = column = offset = 0
        stream = self.output.decode("utf-8", errors="replace")
        while offset < len(stream):
            if stream[offset] == "\x1b":
                match = CSI.match(stream, offset)
                if not match:
                    offset += 1
                    continue
                sequence = match.group()
                numbers = sequence[2:-1].lstrip("?")
                values = [int(part or 0) for part in numbers.split(";")] if numbers else [0]
                count, final = values[0] or 1, sequence[-1]
                if final in ("H", "f"):
                    row, column = count - 1, (values[1] or 1) - 1 if len(values) > 1 else 0
                elif final == "A": row -= count
                elif final == "B": row += count
                elif final == "C": column += count
                elif final == "D": column -= count
                elif final == "G": column = count - 1
                elif final == "J" and values[0] == 2: cells = [[" "] * 80 for _ in range(24)]
                elif final == "K":
                    start = 0 if values[0] in (1, 2) else column
                    end = 80 if values[0] in (0, 2) else column + 1
                    for index in range(start, end): cells[row][index] = " "
                row, column = max(0, min(23, row)), max(0, min(79, column))
                offset = match.end()
                continue
            char = stream[offset]
            if char == "\r": column = 0
            elif char == "\n": row = min(23, row + 1)
            elif char >= " ":
                cells[row][column] = char
                width = 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1
                if width == 2 and column < 79: cells[row][column + 1] = " "
                column = min(79, column + width)
            offset += 1
        return "\n".join("".join(line) for line in cells)

    def until(self, text, seconds=20):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.pump()
            if "".join(text.split()) in "".join(self.screen().split()):
                return
        raise AssertionError(f"Terminal did not reach {text!r}: {self.screen()}")

    def close(self):
        if not self.done:
            os.write(self.fd, b"\x03")
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                self.pump()
                pid, _ = os.waitpid(self.pid, os.WNOHANG)
                if pid:
                    self.done = True
                    break
            if not self.done:
                os.kill(self.pid, 15)
                os.waitpid(self.pid, 0)
        os.close(self.fd)


def line(process, prefix, seconds=35):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if select.select([process.stdout], [], [], 0.2)[0]:
            value = process.stdout.readline().strip()
            if value.startswith(prefix):
                return value
            if not value and process.poll() is not None:
                raise AssertionError(f"Companion fixture failed with exit {process.returncode}: {process.stderr.read()}")
    raise AssertionError(f"Companion fixture did not report {prefix}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--public", action="store_true")
    args = parser.parse_args()
    inspect = json.loads(subprocess.check_output(["docker", "inspect", args.container]))[0]
    ports = inspect["NetworkSettings"]["Ports"]["18780/tcp"]
    assert len(ports) == 1 and ports[0]["HostIp"] == "127.0.0.1"
    address = f"127.0.0.1:{ports[0]['HostPort']}"
    ssh = ["docker", "exec", "-i", args.container, "ssh", "-i", "/experiment/ssh-key", "-p", "2222",
           "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=/experiment/known-hosts"]

    def guest(command, input=None, expect=0):
        completed = subprocess.run([*ssh, "relaytest@127.0.0.1", command],
                                   input=input, text=True, capture_output=True, timeout=180)
        if completed.returncode != expect:
            raise AssertionError(f"Isolated guest command failed (expected {expect}, got {completed.returncode}): {completed.stderr}")
        return completed.stdout

    def verify_client():
        client.stdin.write("verify\n")
        client.stdin.flush()
        line(client, "relay_e2e:")

    terminal = Terminal([*ssh, "-tt", "relaytest@127.0.0.1", "stty rows 24 cols 80; TERM=xterm-256color NO_COLOR=1 codewide-relay pair"])
    client = None
    results = {"scope": "real systemd VM + actual shared Companion + software phone; NAT loopback, no physical handset"}
    try:
        terminal.until("Visible for pairing")
        results["bare_pair_discovers_service_and_public_address"] = True
        client = subprocess.Popen([str(ROOT / "test-results/relay-e2e/client"), address, "--hold"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        code = json.loads(line(client, "code=").removeprefix("code="))
        terminal.until(code.split("\n")[1])
        os.write(terminal.fd, b"\r")
        terminal.until("Connected successfully")
        line(client, "relay_e2e:")
        results["terminal_symbols_match_actual_companion"] = True
        results["phone_pair_mtls_sync_and_revoke_through_relay"] = True
        pid, status = os.waitpid(terminal.pid, 0)
        assert pid == terminal.pid and os.waitstatus_to_exitcode(status) == 0
        terminal.done = True
        state = "$HOME/.local/state/codewide/relay"
        hashes = f"sha256sum {state}/transport-cert.der {state}/transport-key.der"
        identity = guest(hashes)
        # This setting is owned by an administrator, not generated by the installer.
        guest("mkdir -p ~/.config/systemd/user/codewide-relay.service.d; "
              "printf '[Service]\\nRestartSec=7\\nEnvironment=CODEWIDE_E2E_SETTING=retained\\n' > ~/.config/systemd/user/codewide-relay.service.d/operator.conf; "
              "systemctl --user daemon-reload")
        settings = guest("sha256sum ~/.config/systemd/user/codewide-relay.service ~/.config/systemd/user/codewide-relay.service.d/operator.conf")
        install = "curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/relay | sh"
        if args.public:
            # Exercise an actual binary upgrade, not just a repeat of the same version.
            guest(install + " -s -- --version 0.5.0")
            assert guest("codewide-relay --version").strip() == "codewide-relay 0.5.0"
            verify_client()
            guest(install)
            assert guest("codewide-relay --version").strip() == f"codewide-relay {args.version}"
            verify_client()
            results["published_0_5_0_to_latest_upgrade_preserves_live_pairing"] = True
        else:
            guest('umask 077; tee "$HOME/install-relay" >/dev/null', input=(ROOT / "install/relay").read_text())
            guest('CODEWIDE_RELAY_VERSION=0.5.0 sh "$HOME/install-relay"')
            verify_client()
            results["candidate_repeat_preserves_live_pairing"] = True
        assert guest(hashes) == identity
        assert guest("sha256sum ~/.config/systemd/user/codewide-relay.service ~/.config/systemd/user/codewide-relay.service.d/operator.conf") == settings
        assert "CODEWIDE_E2E_SETTING=retained" in guest("systemctl --user show codewide-relay -p Environment --value")
        results["keys_pairings_and_operator_settings_preserved"] = True
        old_binary = guest("sha256sum /usr/local/bin/codewide-relay").split()[0]
        asset = "codewide-relay-x86_64-unknown-linux-musl"
        fixture = f"#!/bin/sh\nif [ \"$1\" = --version ]; then printf '%s\\n' 'codewide-relay {args.version}'; exit 0; fi\nexit 42\n"
        guest(f"mkdir -p /tmp/failed-relay-artifact; umask 077; tee /tmp/failed-relay-artifact/{asset} >/dev/null", input=fixture)
        guest(f"cd /tmp/failed-relay-artifact; sha256sum {asset} > {asset}.sha256")
        script = "curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/relay -o /tmp/public-install-relay" if args.public else 'cp "$HOME/install-relay" /tmp/public-install-relay'
        guest(script)
        failure = guest(f"CODEWIDE_RELAY_VERSION={shlex.quote(args.version)} CODEWIDE_RELAY_ALLOW_INSECURE_DOWNLOAD=1 "
                        "CODEWIDE_RELAY_DOWNLOAD_BASE_URL=file:///tmp/failed-relay-artifact sh /tmp/public-install-relay", expect=1)
        assert "Ready: codewide-relay pair" not in failure
        assert guest("sha256sum /usr/local/bin/codewide-relay").split()[0] == old_binary
        assert guest(hashes) == identity
        assert guest("systemctl --user is-active codewide-relay").strip() == "active"
        verify_client()
        results["real_systemd_failed_start_rolls_back_binary_service_and_live_pairing"] = True
        output = ROOT / "test-results/relay-e2e" / ("public-scenarios.json" if args.public else "candidate-scenarios.json")
        output.write_text(json.dumps(results, indent=2) + "\n")
        print(json.dumps(results, indent=2))
    finally:
        terminal.close()
        if client:
            client.stdin.close()
            try:
                client.wait(timeout=5)
            except subprocess.TimeoutExpired:
                client.terminate()
                client.wait(timeout=5)


if __name__ == "__main__":
    main()
