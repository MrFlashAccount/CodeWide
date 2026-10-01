#!/usr/bin/env python3
"""Installer contracts with real Relay processes and an isolated service manager.

Only systemd/loginctl/sudo are substituted; host services and boot settings are
never changed. systemd-analyze also checks native parsing of the generated unit.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
ASSET = "codewide-relay-x86_64-unknown-linux-musl"


def alive(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1][0] != "Z"
    except FileNotFoundError:
        return False


def stop(pid):
    if not pid or not alive(pid):
        return
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 5
    while alive(pid):
        if time.monotonic() > deadline:
            os.kill(pid, signal.SIGKILL)
            raise RuntimeError("Test Relay did not stop")
        time.sleep(0.02)


def manager_tool(tool, args):
    root = Path(os.environ["CODEWIDE_RELAY_INSTALL_TEST_ROOT"])
    if tool == "sudo":
        return subprocess.call(args[1:] if args[0] == "--" else args)
    if tool == "loginctl":
        marker = root / "linger"
        if args[0] == "enable-linger":
            marker.touch()
        elif args[0] == "disable-linger":
            marker.unlink(missing_ok=True)
        else:
            print("yes" if marker.exists() else "no")
        return 0
    scope = "user" if "--user" in args else "system"
    args = [arg for arg in args if arg != "--user"]
    unit = root / ("config/systemd/user/codewide-relay.service" if scope == "user" else "system.service")
    pid_path = root / f"{scope}.pid"
    enabled = root / f"{scope}.enabled"
    pid = int(pid_path.read_text()) if pid_path.exists() else 0
    running = bool(pid and alive(pid))
    command = args[0]
    if command == "show":
        prop = next((arg.split("=", 1)[1] for arg in args if arg.startswith("--property=")), None)
        if prop is None:
            prop = args[args.index("--property") + 1]
        if prop == "Version":
            if (root / "no-systemd").exists():
                return 1
            print("test-manager")
        elif prop == "FragmentPath":
            print(str(unit) if unit.exists() else "")
        elif prop == "ActiveState":
            print("active" if running else "inactive")
        elif prop == "MainPID":
            print(pid if running else 0)
        else:
            print("")
    elif command == "is-active":
        return 0 if running else 3
    elif command == "is-enabled":
        return 0 if enabled.exists() else 1
    elif command == "enable":
        enabled.touch()
    elif command == "disable":
        enabled.unlink(missing_ok=True)
    elif command in ("stop", "restart"):
        stop(pid)
        pid_path.unlink(missing_ok=True)
        if command == "restart":
            line = next(line for line in unit.read_text().splitlines() if line.startswith("ExecStart="))
            invocation = shlex.split(line.removeprefix("ExecStart=").replace("%%", "%").replace("$$", "$"))
            # Isolate each real Relay on a free port; the generated unit uses 8780.
            if "--port" not in invocation:
                invocation += ["--port", os.environ["CODEWIDE_RELAY_INSTALL_TEST_PORT"]]
            with (root / f"{scope}.log").open("ab") as log:
                process = subprocess.Popen(invocation, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            pid_path.write_text(str(process.pid))
    elif command == "show-environment":
        delayed = root / "manager-delayed"
        if delayed.exists():
            remaining = int(delayed.read_text())
            if remaining:
                delayed.write_text(str(remaining - 1))
                return 1
    elif command != "daemon-reload":
        raise RuntimeError(f"Unexpected manager operation: {command}")
    return 0


class InstallerServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="codewide-relay-service-test.")
        self.root = Path(self.temporary.name)
        self.bin = self.root / 'bin with spaces % $ "'
        self.bin.mkdir()
        tools = self.root / "tools"
        tools.mkdir()
        for tool in ("systemctl", "loginctl", "sudo"):
            (tools / tool).symlink_to(Path(__file__).resolve())
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.release = self.root / "release"
        self.release.mkdir()
        self.payload = self.release / ASSET
        shutil.copyfile(DIST / ASSET, self.payload)
        self.payload.chmod(0o755)
        self.version = subprocess.check_output([str(self.payload), "--version"], text=True).split()[1]
        self.checksum()
        self.env = {
            **os.environ,
            "PATH": f"{tools}:{self.bin}:{os.environ['PATH']}",
            "XDG_CONFIG_HOME": str(self.root / "config"),
            "XDG_STATE_HOME": str(self.root / "state with spaces % $"),
            "CODEWIDE_RELAY_INSTALL_TEST_ROOT": str(self.root),
            "CODEWIDE_RELAY_INSTALL_TEST_PORT": str(self.port),
            "CODEWIDE_RELAY_INSTALL_DIR": str(self.bin),
            "CODEWIDE_RELAY_VERSION": self.version,
            "CODEWIDE_RELAY_DOWNLOAD_BASE_URL": self.release.as_uri(),
            "CODEWIDE_RELAY_ALLOW_INSECURE_DOWNLOAD": "1",
        }
        self.unit = self.root / "config/systemd/user/codewide-relay.service"
        self.state = Path(self.env["XDG_STATE_HOME"]) / "codewide/relay"

    def tearDown(self):
        try:
            for scope in ("user", "system"):
                pid = self.root / f"{scope}.pid"
                if pid.exists():
                    stop(int(pid.read_text()))
        finally:
            self.temporary.cleanup()

    def checksum(self):
        digest = hashlib.sha256(self.payload.read_bytes()).hexdigest()
        (self.release / f"{ASSET}.sha256").write_text(f"{digest}  {ASSET}\n")

    def install(self, *args):
        # Match curl | sh: the installer and its child commands receive a pipe.
        return subprocess.run(["sh", "-s", "--", *args], input=(ROOT / "install/relay").read_bytes(), env=self.env, capture_output=True, timeout=45)

    def cli(self, *args, env=None):
        result = subprocess.run([str(self.bin / "codewide-relay"), *args], env=env or self.env, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        return json.loads(result.stdout)

    def assert_ready(self):
        self.assertEqual(self.cli("status", "--json")["port"], self.port)
        self.assertTrue((self.state / "control.sock").is_socket())
        self.assertEqual((self.state / "transport-key.der").stat().st_mode & 0o777, 0o600)

    def identity(self):
        # The wire pin is the exact leaf-certificate hash: preserving these
        # bytes protects an explicit trust contract, not a registry JSON format.
        return {name: hashlib.sha256((self.state / name).read_bytes()).hexdigest() for name in ("transport-cert.der", "transport-key.der")}

    def request(self, method, path, body=None, headers=None):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.load_verify_locations(cadata=ssl.DER_cert_to_PEM_cert((self.state / "transport-cert.der").read_bytes()))
        connection = http.client.HTTPSConnection("127.0.0.1", self.port, context=context, timeout=5)
        try:
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def paired_computer(self):
        bundle = self.cli("invite")
        status, body = self.request("POST", f'/relay/pair/{bundle["routeId"]}', json.dumps({"invitation": bundle["invitation"]}), {"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        credentials = json.loads(body)
        self.assertEqual(credentials["routeId"], bundle["routeId"])
        self.cli("rename", "--route", credentials["routeId"], "--label", "Installer test Mac", "--json")
        self.assert_authorized(credentials)
        return credentials

    def assert_authorized(self, credentials):
        routes = self.cli("status", "--json")["routes"]
        saved = next((route for route in routes if route["routeId"] == credentials["routeId"]), None)
        self.assertIsNotNone(saved)
        self.assertEqual(saved["label"], "Installer test Mac")
        # A real authenticated WebSocket upgrade proves the old token survived.
        headers = {"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "aW5zdGFsbGVyLXRlc3QhIQ==", "Authorization": f'Bearer {credentials["accessToken"]}'}
        status, _ = self.request("GET", f'/relay/control/{credentials["routeId"]}', headers=headers)
        self.assertEqual(status, 101)
        headers["Authorization"] = "Bearer invalid-token"
        status, _ = self.request("GET", f'/relay/control/{credentials["routeId"]}', headers=headers)
        self.assertEqual(status, 401)

    def test_fresh_install_repeat_and_discovery_without_flags(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b"Ready: codewide-relay pair", result.stdout)
        self.assertTrue((self.root / "user.enabled").exists())
        self.assertTrue((self.root / "linger").exists())
        self.assert_ready()
        computer = self.paired_computer()
        pending = self.cli("invite")
        identity = self.identity()
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(self.identity(), identity)
        self.assert_authorized(computer)
        # An unconsumed invitation remains usable after the service restart.
        status, _ = self.request("POST", f'/relay/pair/{pending["routeId"]}', json.dumps({"invitation": pending["invitation"]}), {"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        other_env = {**self.env, "XDG_STATE_HOME": str(self.root / "unrelated")}
        self.assertEqual(self.cli("status", "--json", env=other_env)["port"], self.port)
        self.assertFalse((self.root / "unrelated").exists())
        analyzer = shutil.which("systemd-analyze")
        if analyzer:
            verified = subprocess.run([analyzer, "--user", "verify", str(self.unit)], capture_output=True, env=self.env)
            self.assertEqual(verified.returncode, 0, verified.stderr.decode())

    def custom_unit(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        executable = str(self.bin / "codewide-relay").replace("%", "%%").replace("$", "$$").replace('"', '\\"')
        path.write_text(f'[Service]\nExecStart=/usr/bin/env -- "{executable}" serve --state "{self.state}" --port {self.port}\nRestart=on-failure\nUMask=0077\nNoNewPrivileges=yes\n\n[Install]\nWantedBy=default.target\n')

    def test_upgrade_preserves_custom_unit_port_and_identity(self):
        self.state = self.root / "custom-state"
        self.custom_unit(self.unit)
        unit = self.unit.read_bytes()
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        computer = self.paired_computer()
        identity = self.identity()
        # A different verified artifact models an in-place upgrade, not a reset.
        with self.payload.open("ab") as file:
            file.write(b"\ninstaller-upgrade-fixture\n")
        self.checksum()
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(self.unit.read_bytes(), unit)
        self.assertEqual(self.identity(), identity)
        self.assert_authorized(computer)
        self.assert_ready()

    def test_failed_readiness_restores_previous_binary_and_running_service(self):
        self.assertEqual(self.install().returncode, 0)
        computer = self.paired_computer()
        identity = self.identity()
        binary = hashlib.sha256((self.bin / "codewide-relay").read_bytes()).hexdigest()
        # Correct checksum/version, but the candidate cannot administer its daemon.
        self.payload.write_text(f'#!/bin/sh\ncase "$1" in\n --version) echo "codewide-relay {self.version}";;\n status) exit 1;;\n *) exec {shlex.quote(str(DIST / ASSET))} "$@";;\nesac\n')
        self.payload.chmod(0o755)
        self.checksum()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(b"Ready:", result.stdout)
        self.assertIn(b"did not become ready", result.stderr)
        self.assertEqual(hashlib.sha256((self.bin / "codewide-relay").read_bytes()).hexdigest(), binary)
        self.assertEqual(self.identity(), identity)
        self.assert_authorized(computer)
        self.assert_ready()

    def test_failed_fresh_install_restores_linger_and_removes_failed_deployment(self):
        self.payload.write_text(f'#!/bin/sh\nif [ "$1" = --version ]; then echo "codewide-relay {self.version}"; else exit 1; fi\n')
        self.payload.chmod(0o755)
        self.checksum()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.unit.exists())
        self.assertFalse((self.bin / "codewide-relay").exists())
        self.assertFalse((self.root / "user.enabled").exists())
        self.assertFalse((self.root / "linger").exists())

    def test_existing_system_service_is_updated_without_a_second_identity(self):
        self.state = self.root / "system-state"
        system_unit = self.root / "system.service"
        self.custom_unit(system_unit)
        unit = system_unit.read_bytes()
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        computer = self.paired_computer()
        identity = self.identity()
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(system_unit.read_bytes(), unit)
        self.assertEqual(self.identity(), identity)
        self.assert_authorized(computer)
        self.assertFalse(self.unit.exists())
        self.assertFalse(Path(self.env["XDG_STATE_HOME"]).exists())
        self.assert_ready()

    def test_non_systemd_requires_explicit_binary_only_install(self):
        (self.root / "no-systemd").touch()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.bin / "codewide-relay").exists())
        result = self.install("--no-start")
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertNotIn(b"Ready:", result.stdout)
        self.assertFalse(self.unit.exists())
        self.assertFalse((self.root / "linger").exists())

    def test_ambiguous_services_are_rejected_before_installing(self):
        self.unit.parent.mkdir(parents=True)
        self.unit.touch()
        (self.root / "system.service").touch()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"Both system and user", result.stderr)
        self.assertFalse((self.bin / "codewide-relay").exists())

    def test_asynchronous_user_manager_start_is_waited_for(self):
        (self.root / "manager-delayed").write_text("2")
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual((self.root / "manager-delayed").read_text(), "0")
        self.assert_ready()

    def test_running_foreground_server_is_not_taken_over(self):
        self.state.mkdir(parents=True)
        with (self.root / "foreground.log").open("wb") as log:
            process = subprocess.Popen([str(DIST / ASSET), "serve", "--state", str(self.state), "--port", str(self.port)], env=self.env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 5
            while not (self.state / "control.sock").is_socket():
                self.assertIsNone(process.poll())
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            identity = self.identity()
            result = self.install()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"manually managed Relay is already running", result.stderr)
            self.assertIsNone(process.poll())
            self.assertEqual(self.identity(), identity)
            self.assertFalse(self.unit.exists())
            self.assertFalse((self.bin / "codewide-relay").exists())
        finally:
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    tool_name = Path(sys.argv[0]).name
    if tool_name in ("systemctl", "loginctl", "sudo"):
        sys.exit(manager_tool(tool_name, sys.argv[1:]))
    DIST = Path(sys.argv.pop(1)).resolve()
    unittest.main(verbosity=2)
