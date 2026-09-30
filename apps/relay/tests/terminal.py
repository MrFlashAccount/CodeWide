"""Run the built Rust CLI in a real PTY against an isolated loopback fixture."""
from pathlib import Path
import fcntl
import json
import os
import pty
import re
import select
import signal
import socket
import stat
import struct
import subprocess
import tempfile
import termios
import time
import unicodedata

ROOT = Path(__file__).resolve().parents[3]
BIN = ROOT / "target/debug/codewide-relay"
CLIENT = ROOT / "target/debug/examples/enrollment-smoke"
OUTPUT = Path(os.environ.get("CODEWIDE_RELAY_TEST_OUTPUT", str(ROOT / "test-results/relay-cli")))
OUTPUT.mkdir(parents=True, exist_ok=True)
CSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")

class Terminal:
    def __init__(self, args, columns=80, no_color=False, extra_env=None):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            environment = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor")
            environment.update(extra_env or {})
            if no_color:
                environment["NO_COLOR"] = "1"
            else:
                environment.pop("NO_COLOR", None)
            os.execve(str(BIN), [str(BIN), *args], environment)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, columns, 0, 0))
        self.output = b""
        self.status = None
        self.columns = columns

    def screen(self):
        # Interpret cursor updates, including unchanged cells omitted by Ratatui.
        cells = [[" "] * self.columns for _ in range(24)]
        row = column = 0
        stream = self.output.decode("utf-8", errors="replace")
        offset = 0
        while offset < len(stream):
            if stream[offset] == "\x1b":
                command = CSI.match(stream, offset)
                if not command:
                    break
                sequence = command.group()
                numbers = sequence[2:-1].lstrip("?")
                values = [int(part or 0) for part in numbers.split(";")] if numbers else [0]
                count = values[0] or 1
                final = sequence[-1]
                if final in ("H", "f"):
                    row = count - 1
                    column = (values[1] or 1) - 1 if len(values) > 1 else 0
                elif final == "A": row -= count
                elif final == "B": row += count
                elif final == "C": column += count
                elif final == "D": column -= count
                elif final == "E": row += count; column = 0
                elif final == "F": row -= count; column = 0
                elif final == "G": column = count - 1
                elif final == "K":
                    start = 0 if values[0] in (1, 2) else column
                    end = self.columns if values[0] in (0, 2) else column + 1
                    for index in range(start, end): cells[row][index] = " "
                elif final == "J" and values[0] == 2:
                    cells = [[" "] * self.columns for _ in range(24)]
                row = max(0, min(23, row))
                column = max(0, min(self.columns - 1, column))
                offset = command.end()
                continue
            char = stream[offset]
            if char == "\r": column = 0
            elif char == "\n": row = min(23, row + 1)
            elif char >= " ":
                cells[row][column] = char
                width = 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1
                if width == 2 and column + 1 < self.columns: cells[row][column + 1] = " "
                column = min(self.columns - 1, column + width)
            offset += 1
        return "\n".join("".join(line) for line in cells)

    def pump(self, timeout=0.1):
        if select.select([self.fd], [], [], timeout)[0]:
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                return
            self.output += data
            # Standard cursor-position report from the terminal emulator.
            if b"\x1b[6n" in data:
                os.write(self.fd, b"\x1b[1;1R")

    def until(self, needle, timeout=12):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.pump()
            rendered = self.screen()
            if "".join(needle.split()) in "".join(rendered.split()):
                return
        raise AssertionError(f"Terminal did not show {needle!r}: {self.output[-600:]!r}")

    def finish(self, expected):
        end = time.monotonic() + 8
        while time.monotonic() < end:
            self.pump()
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.status = os.waitstatus_to_exitcode(status)
                assert self.status == expected, (self.status, self.output[-2500:])
                flags = termios.tcgetattr(self.fd)[3]
                assert flags & termios.ICANON and flags & termios.ECHO, "Raw terminal state was not restored"
                return
        raise AssertionError(f"CLI did not exit: {self.screen()}")

    def close(self):
        if self.status is None:
            try:
                os.kill(self.pid, signal.SIGTERM)
                end = time.monotonic() + 3
                while time.monotonic() < end:
                    self.pump()
                    pid, status = os.waitpid(self.pid, os.WNOHANG)
                    if pid:
                        self.status = os.waitstatus_to_exitcode(status)
                        break
                else:
                    os.kill(self.pid, signal.SIGKILL)
                    os.waitpid(self.pid, 0)
            except ProcessLookupError:
                pass
        os.close(self.fd)

# macOS's per-user TMPDIR can exhaust the Unix socket path limit by itself.
with tempfile.TemporaryDirectory(prefix="codewide-cli-", dir="/tmp") as temporary:
    state = Path(temporary) / "codewide/relay"
    reservation = socket.socket()
    reservation.bind(("127.0.0.1", 0))
    port = reservation.getsockname()[1]
    reservation.close()
    address = f"127.0.0.1:{port}"
    # Existing installed service units use flags without an explicit `serve`.
    daemon = subprocess.Popen(
        [str(BIN), "--state", str(state), "--port", str(port), "--group-admin"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    terminals = []
    peer = None
    results = {}
    try:
        end = time.monotonic() + 8
        while not (state / "control.sock").exists():
            if time.monotonic() > end or daemon.poll() is not None:
                detail = daemon.stderr.read().decode() if daemon.poll() is not None else "startup timeout"
                raise AssertionError(f"Test Relay failed to start: {detail}")
            time.sleep(0.02)
        assert stat.S_IMODE(state.stat().st_mode) == 0o710
        assert stat.S_IMODE((state / "control.sock").stat().st_mode) == 0o660
        assert stat.S_IMODE((state / "routes").stat().st_mode) == 0o700
        assert stat.S_IMODE((state / "transport-key.der").stat().st_mode) == 0o600
        results["group_admin_exposes_only_control_socket"] = True
        raw = subprocess.run([str(BIN), "--state", str(state), "status", "--json"], capture_output=True, check=True)
        assert json.loads(raw.stdout)["routes"] == [] and b"\x1b" not in raw.stdout
        results["json_status"] = True
        no_tty = subprocess.run([str(BIN), "--state", str(state), "pair"], capture_output=True)
        assert no_tty.returncode != 0 and b"interactive terminal" in no_tty.stderr
        results["noninteractive_pair_rejected"] = True

        results["existing_service_arguments_still_start_daemon"] = True
        identity = {name: (state / name).read_bytes() for name in ("transport-cert.der", "transport-key.der")}
        bare = Terminal([], columns=44, no_color=True, extra_env={"XDG_STATE_HOME": temporary})
        terminals.append(bare)
        bare.until("CodeWide Relay / Home")
        bare.until("Esc Exit")
        (OUTPUT / "relay-menu-home.ansi").write_bytes(bare.output)
        os.write(bare.fd, b"\x1b[B\r")
        bare.until("No computers paired yet.")
        os.write(bare.fd, b"\x1b")
        bare.until("CodeWide Relay / Home")
        os.write(bare.fd, b"\x1b")
        bare.finish(0)
        assert daemon.poll() is None
        assert all((state / name).read_bytes() == value for name, value in identity.items())
        results["bare_command_opens_menu_without_second_server_or_identity"] = True
        results["menu_lists_computers_and_returns_without_commands"] = True
        default_status = subprocess.run([str(BIN), "--state", str(state), "--json"], capture_output=True, timeout=5, check=True)
        assert json.loads(default_status.stdout)["port"] == port
        results["noninteractive_default_reads_status"] = True
        absent = Path(temporary) / "absent"
        missing = subprocess.run([str(BIN), "--state", str(absent)], capture_output=True, timeout=5)
        assert missing.returncode == 1 and not absent.exists()
        results["default_never_initializes_an_unrelated_registry"] = True

        menu_args = ["--state", str(state), "--address", address]
        menu_cancel = Terminal(menu_args)
        terminals.append(menu_cancel)
        menu_cancel.until("CodeWide Relay / Home")
        os.write(menu_cancel.fd, b"\r")
        menu_cancel.until("Visible for pairing")
        os.write(menu_cancel.fd, b"\x1b")
        menu_cancel.until("CodeWide Relay / Home")
        os.write(menu_cancel.fd, b"\x03")
        menu_cancel.finish(130)
        results["menu_starts_pairing_and_escape_returns_home"] = True
        results["menu_ctrl_c_restores_terminal"] = True

        menu_signal = Terminal(menu_args)
        terminals.append(menu_signal)
        menu_signal.until("CodeWide Relay / Home")
        os.kill(menu_signal.pid, signal.SIGTERM)
        menu_signal.finish(143)
        results["menu_sigterm_restores_terminal"] = True

        args = ["--state", str(state), "pair", "--address", address]
        terminal = Terminal(args)
        terminals.append(terminal)
        terminal.until("Visible for pairing")
        # A premature Enter is not a confirmation.
        os.write(terminal.fd, b"\r")
        for _ in range(3): terminal.pump()
        peer = subprocess.Popen([str(CLIENT), address], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        end = time.monotonic() + 10
        while not select.select([peer.stdout], [], [], 0)[0]:
            terminal.pump()
            if time.monotonic() > end: raise AssertionError("Peer did not return a locally computed code")
        line = peer.stdout.readline().strip()
        assert line.startswith("code=")
        code = json.loads(line.removeprefix("code="))
        for part in code.splitlines(): terminal.until(part)
        terminal.until("Same symbols on your Mac?")
        assert peer.poll() is None
        os.write(terminal.fd, b"\r")
        terminal.until("Connected successfully")
        terminal.finish(0)
        assert peer.communicate(timeout=5)[0].strip() == "connected" and peer.returncode == 0
        (OUTPUT / "relay-cli-success.ansi").write_bytes(terminal.output)
        results["matching_code_pairing"] = True
        results["premature_enter_ignored"] = True
        results["terminal_restored_after_success"] = True

        status = subprocess.run([str(BIN), "--state", str(state), "status", "--json"], capture_output=True, check=True)
        assert json.loads(status.stdout)["routes"][0]["label"] == "CLI test Mac"
        results["computer_label_persisted"] = True

        menu_pair = Terminal(menu_args)
        terminals.append(menu_pair)
        menu_pair.until("CodeWide Relay / Home")
        os.write(menu_pair.fd, b"\r")
        menu_pair.until("Visible for pairing")
        peer = subprocess.Popen([str(CLIENT), address], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        end = time.monotonic() + 10
        while not select.select([peer.stdout], [], [], 0)[0]:
            menu_pair.pump()
            if time.monotonic() > end: raise AssertionError("Menu peer did not produce symbols")
        code = json.loads(peer.stdout.readline().strip().removeprefix("code="))
        for part in code.splitlines(): menu_pair.until(part)
        os.write(menu_pair.fd, b"\r")
        menu_pair.until("Connected successfully")
        menu_pair.until("Back to Relay")
        assert peer.communicate(timeout=5)[0].strip() == "connected" and peer.returncode == 0
        os.write(menu_pair.fd, b"\r")
        menu_pair.until("Paired computers (2)")
        os.write(menu_pair.fd, b"\x1b[B\r")
        menu_pair.until("CLI test Mac")
        (OUTPUT / "relay-menu-computers.ansi").write_bytes(menu_pair.output)
        os.write(menu_pair.fd, b"e")
        menu_pair.until("New name: CLI test Mac_")
        os.write(menu_pair.fd, b"\x7f" * len("CLI test Mac") + b"Renamed Mac\r")
        menu_pair.until("Computer renamed.")
        menu_pair.until("Renamed Mac")
        results["menu_renames_selected_computer"] = True
        os.write(menu_pair.fd, b"d")
        menu_pair.until("Revoke Renamed Mac?")
        os.write(menu_pair.fd, b"y")
        menu_pair.until("Computer access revoked.")
        results["menu_revokes_selected_computer"] = True
        os.write(menu_pair.fd, b"\x1b")
        menu_pair.until("CodeWide Relay / Home")
        os.write(menu_pair.fd, b"\x1b")
        menu_pair.finish(0)
        results["menu_pairs_and_returns_to_updated_computers"] = True

        # stdout is a pipe even if stderr remains attached to the user's terminal.
        read_fd, write_fd = pty.openpty()
        try:
            environment = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor")
            environment.pop("NO_COLOR", None)
            piped = subprocess.run([str(BIN), "--state", str(state), "status"], stdout=subprocess.PIPE, stderr=write_fd, env=environment, check=True)
            assert b"\x1b" not in piped.stdout
        finally:
            os.close(read_fd)
            os.close(write_fd)
        results["piped_status_has_no_ansi"] = True

        cancel = Terminal(args, columns=44, no_color=True)
        terminals.append(cancel)
        cancel.until("Visible for pairing")
        os.write(cancel.fd, b"\x03")
        cancel.until("Pairing cancelled")
        cancel.finish(130)
        assert b"38;2;" not in cancel.output and b"48;2;" not in cancel.output
        (OUTPUT / "relay-cli-cancel-no-color.ansi").write_bytes(cancel.output)
        results["narrow_terminal_no_color"] = True
        results["ctrl_c_cancels_and_restores_terminal"] = True

        retry = Terminal(args)
        terminals.append(retry)
        retry.until("Visible for pairing")
        os.write(retry.fd, b"\x1b")
        retry.finish(130)
        results["cancel_releases_window_for_retry"] = True

        terminated = Terminal(args)
        terminals.append(terminated)
        terminated.until("Visible for pairing")
        os.kill(terminated.pid, signal.SIGTERM)
        terminated.finish(143)
        results["sigterm_cancels_and_restores_terminal"] = True

        expired = Terminal(args)
        terminals.append(expired)
        expired.until("Visible for pairing")
        started = time.monotonic()
        expired.until("Pairing window closed", timeout=65)
        expired.finish(124)
        assert time.monotonic() - started >= 58
        results["minute_deadline_closes_window"] = True

        disconnected = Terminal(args)
        terminals.append(disconnected)
        disconnected.until("Visible for pairing")
        menu_failure = Terminal(menu_args)
        terminals.append(menu_failure)
        menu_failure.until("CodeWide Relay / Home")
        daemon.terminate()
        daemon.wait(timeout=5)
        disconnected.until("Pairing failed")
        disconnected.finish(1)
        results["service_disconnect_restores_terminal_and_shows_failure"] = True
        os.write(menu_failure.fd, b"r")
        menu_failure.until("Needs attention")
        os.write(menu_failure.fd, b"\x1b")
        menu_failure.finish(0)
        results["menu_recovers_keyboard_control_after_service_failure"] = True
    finally:
        for terminal in terminals: terminal.close()
        if peer and peer.poll() is None: peer.terminate(); peer.wait(timeout=5)
        daemon.terminate()
        daemon.wait(timeout=5)
    (OUTPUT / "relay-cli-pty-results.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))
