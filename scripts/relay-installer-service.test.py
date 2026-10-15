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
import tarfile
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
ASSET = "codewide-relay-x86_64-unknown-linux-musl"
BUNDLE = f"{ASSET}.tar.gz"
UPDATE_UNITS = ("codewide-relay-update.path", "codewide-relay-update.service")


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
        (root / "sudo-used").touch()
        if args == ["-v"]:
            return 0
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
    unit_name = args[-1] if len(args) > 1 else ""
    enabled = root / (
        f"{scope}.update.enabled"
        if unit_name in UPDATE_UNITS
        else f"{scope}.enabled"
    )
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
        if "--now" in args and unit_name == "codewide-relay.service":
            stop(pid)
            pid_path.unlink(missing_ok=True)
            line = next(line for line in unit.read_text().splitlines() if line.startswith("ExecStart="))
            invocation = shlex.split(line.removeprefix("ExecStart=").replace("%%", "%").replace("$$", "$"))
            if "--port" not in invocation:
                invocation += ["--port", os.environ["CODEWIDE_RELAY_INSTALL_TEST_PORT"]]
            with (root / f"{scope}.log").open("ab") as log:
                process = subprocess.Popen(invocation, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            pid_path.write_text(str(process.pid))
    elif command == "disable":
        enabled.unlink(missing_ok=True)
        if "--now" in args and unit_name == "codewide-relay.service":
            stop(pid)
            pid_path.unlink(missing_ok=True)
    elif command in ("stop", "restart"):
        if unit_name == "codewide-relay.service":
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
            "CODEWIDE_RELAY_SYSTEMD_UNIT_DIR": str(self.root / "systemd/system"),
            "CODEWIDE_RELAY_INSTALL_ROOT": str(self.root / "lib with spaces % $"),
        }
        self.install_root = Path(self.env["CODEWIDE_RELAY_INSTALL_ROOT"])
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
        """Publishes the payload as both release assets: the bare executable
        for binary-only installs and the generation bundle for a service."""
        digest = hashlib.sha256(self.payload.read_bytes()).hexdigest()
        (self.release / f"{ASSET}.sha256").write_text(f"{digest}  {ASSET}\n")
        staging = self.root / "bundle-staging"
        shutil.rmtree(staging, ignore_errors=True)
        (staging / ASSET / "bin").mkdir(parents=True)
        shutil.copyfile(self.payload, staging / ASSET / "bin/codewide-relay")
        (staging / ASSET / "bin/codewide-relay").chmod(0o755)
        with tarfile.open(self.release / BUNDLE, "w:gz") as archive:
            for source in sorted((staging / ASSET).rglob("*"), key=lambda path: str(path)):
                relative = source.relative_to(staging)
                info = archive.gettarinfo(source, arcname=str(relative))
                info.uid = 0
                info.gid = 0
                info.uname = ""
                info.gname = ""
                info.mtime = 0
                if source.is_file():
                    with source.open("rb") as payload:
                        archive.addfile(info, payload)
                else:
                    archive.addfile(info)
        self.bundle_digest = hashlib.sha256((self.release / BUNDLE).read_bytes()).hexdigest()
        (self.release / f"{BUNDLE}.sha256").write_text(f"{self.bundle_digest}  {BUNDLE}\n")

    def assert_generation_active(self):
        current = self.install_root / "current"
        self.assertTrue(current.is_symlink())
        self.assertEqual(os.readlink(current), f"generations/{self.bundle_digest}")
        metadata = json.loads((current / "metadata.json").read_text())
        self.assertEqual(metadata["version"], self.version)
        self.assertEqual(metadata["artifactDigest"], self.bundle_digest)
        self.assertEqual(
            (current / "bin/codewide-relay").read_bytes(), self.payload.read_bytes()
        )
        self.assertEqual(
            os.readlink(self.bin / "codewide-relay"),
            str(self.install_root / "current/bin/codewide-relay"),
        )
        guardian = self.install_root / "bootstrap/codewide-relay-update-guardian"
        self.assertTrue(guardian.is_file() and not guardian.is_symlink())
        self.assertEqual(guardian.stat().st_mode & 0o777, 0o755)
        update_unit = (self.root / "config/systemd/user/codewide-relay-update.service").read_text()
        self.assertIn("update-run --install-root", update_unit)
        self.assertIn("IPAddressDeny=any", update_unit)
        self.assertNotIn("network-online.target", update_unit)
        # A user manager cannot drop the bounding set; the unit would exit 218.
        self.assertNotIn("CapabilityBoundingSet", update_unit)
        update_path = (self.root / "config/systemd/user/codewide-relay-update.path").read_text()
        self.assertIn("activation-request.json", update_path)
        self.assertIn("PathExists=", update_path)
        self.assertIn("Unit=codewide-relay-update.service", update_path)
        self.assertIn("WantedBy=default.target", update_path)
        self.assertFalse((self.state / "update").exists())

    def install(self, *args, env=None):
        # Match curl | sh: the installer and its child commands receive a pipe.
        return subprocess.run(
            ["sh", "-s", "--", *args],
            input=(ROOT / "install/relay").read_bytes(),
            env=env or self.env,
            capture_output=True,
            timeout=45,
        )

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
        self.assertTrue((self.root / "user.update.enabled").exists())
        self.assertFalse((self.root / "linger").exists())
        self.assertFalse((self.root / "sudo-used").exists())
        self.assertIn(b"starts after login", result.stdout)
        self.assert_generation_active()
        self.assert_ready()
        computer = self.paired_computer()
        pending = self.cli("invite")
        identity = self.identity()
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(self.identity(), identity)
        self.assert_authorized(computer)
        # Reinstalling the same release reuses its immutable generation.
        self.assert_generation_active()
        self.assertEqual(len(list((self.install_root / "generations").iterdir())), 1)
        # An unconsumed invitation remains usable after the service restart.
        status, _ = self.request("POST", f'/relay/pair/{pending["routeId"]}', json.dumps({"invitation": pending["invitation"]}), {"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        other_env = {**self.env, "XDG_STATE_HOME": str(self.root / "unrelated")}
        self.assertEqual(self.cli("status", "--json", env=other_env)["port"], self.port)
        self.assertFalse((self.root / "unrelated").exists())
        analyzer = shutil.which("systemd-analyze")
        if analyzer:
            verified = subprocess.run([analyzer, "--user", "verify", str(self.unit), str(self.unit.with_name("codewide-relay-update.service")), str(self.unit.with_name("codewide-relay-update.path"))], capture_output=True, env=self.env)
            self.assertEqual(verified.returncode, 0, verified.stderr.decode())

    def test_default_install_is_on_path_without_sudo(self):
        home = self.root / "home"
        env = {
            **self.env,
            "HOME": str(home),
            "PATH": f"{home / '.local/bin'}:{self.root / 'tools'}:{os.environ['PATH']}",
        }
        env.pop("CODEWIDE_RELAY_INSTALL_DIR")

        result = self.install(env=env)

        self.assertEqual(result.returncode, 0, result.stderr.decode())
        installed = home / ".local/bin/codewide-relay"
        self.assertTrue(installed.is_file())
        self.assertFalse((self.root / "sudo-used").exists())
        self.assertIn(b"Ready: codewide-relay pair", result.stdout)
        status = subprocess.run(
            ["codewide-relay", "status", "--json"],
            env=env,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(status.returncode, 0, status.stderr.decode())
        self.assertEqual(json.loads(status.stdout)["port"], self.port)

    def test_default_install_rejects_a_destination_outside_path(self):
        home = self.root / "home"
        env = {
            **self.env,
            "HOME": str(home),
            "PATH": f"{self.root / 'tools'}:{os.environ['PATH']}",
        }
        env.pop("CODEWIDE_RELAY_INSTALL_DIR")

        result = self.install(env=env)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"No standard user executable directory is present in PATH", result.stderr)
        self.assertFalse((home / ".local/bin/codewide-relay").exists())
        self.assertFalse((self.root / "sudo-used").exists())

    def custom_unit(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        executable = str(self.bin / "codewide-relay").replace("%", "%%").replace("$", "$$").replace('"', '\\"')
        path.write_text(f'[Service]\nExecStart=/usr/bin/env -- "{executable}" serve --state "{self.state}" --port {self.port}\nRestart=on-failure\nUMask=0077\nNoNewPrivileges=yes\n\n[Install]\nWantedBy=default.target\n')

    def start_existing_service(self, scope):
        installed = self.bin / "codewide-relay"
        shutil.copyfile(self.payload, installed)
        installed.chmod(0o755)
        command = ["systemctl"]
        if scope == "user":
            command.append("--user")
        command += ["restart", "codewide-relay.service"]
        result = subprocess.run(command, env=self.env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assert_ready()

    def legacy_system_migration_fixture(self):
        home = self.root / "home"
        user_bin = home / ".local/bin"
        user_bin.mkdir(parents=True)
        system_binary = self.root / "system-bin/codewide-relay"
        system_binary.parent.mkdir()
        shutil.copyfile(self.payload, system_binary)
        system_binary.chmod(0o755)
        system_updater = system_binary.parent / "codewide-relay-updater"
        system_updater.write_text("#!/bin/sh\n# legacy root updater\n")
        system_updater.chmod(0o755)
        self.bin = system_binary.parent
        self.state = self.root / "system-state"
        system_unit = self.root / "system.service"
        executable = str(system_binary).replace("%", "%%").replace("$", "$$").replace('"', '\\"')
        system_unit.write_text(
            f'[Service]\nExecStart=/usr/bin/env -- "{executable}" serve --state "{self.state}" --port {self.port}\nRestart=on-failure\nUMask=0077\nNoNewPrivileges=yes\n\n[Install]\nWantedBy=multi-user.target\n'
        )
        system_update_service = self.root / "codewide-relay-update.service"
        system_update_path = self.root / "codewide-relay-update.path"
        system_update_service.write_text("[Service]\nType=oneshot\n")
        system_update_path.write_text("[Path]\nPathExists=/unused\n")
        start = subprocess.run(
            ["systemctl", "restart", "codewide-relay.service"],
            env=self.env,
            capture_output=True,
        )
        self.assertEqual(start.returncode, 0, start.stderr.decode())
        self.assert_ready()
        stale_user_state = Path(self.env["XDG_STATE_HOME"]) / "codewide/relay"
        stale_user_state.mkdir(parents=True)
        (stale_user_state / "preexisting-marker").write_text("preserve me")
        env = {
            **self.env,
            "HOME": str(home),
            "PATH": f"{user_bin}:{self.root / 'tools'}:{os.environ['PATH']}",
            "CODEWIDE_RELAY_MIGRATION_SYSTEM_BINARY": str(system_binary),
            "CODEWIDE_RELAY_MIGRATION_SYSTEM_STATE_ROOT": str(self.state),
            "CODEWIDE_RELAY_MIGRATION_SYSTEM_UNIT": str(system_unit),
            "CODEWIDE_RELAY_MIGRATION_SYSTEM_DROPINS": str(self.root / "system.service.d"),
        }
        env.pop("CODEWIDE_RELAY_INSTALL_DIR")
        return {
            "env": env,
            "system_binary": system_binary,
            "system_unit": system_unit,
            "system_updater": system_updater,
            "system_update_service": system_update_service,
            "system_update_path": system_update_path,
            "user_bin": user_bin,
            "user_state": stale_user_state,
        }

    def test_upgrade_preserves_custom_unit_port_and_identity(self):
        self.state = self.root / "custom-state"
        self.custom_unit(self.unit)
        self.start_existing_service("user")
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
        # The upgrade is a new generation; the previous one stays for rollback.
        self.assert_generation_active()
        self.assertEqual(len(list((self.install_root / "generations").iterdir())), 2)

    def test_failed_readiness_restores_previous_binary_and_running_service(self):
        self.assertEqual(self.install().returncode, 0)
        computer = self.paired_computer()
        identity = self.identity()
        binary = hashlib.sha256((self.bin / "codewide-relay").read_bytes()).hexdigest()
        previous_generation = os.readlink(self.install_root / "current")
        # Correct checksum/version, but the candidate cannot administer its daemon.
        self.payload.write_text(f'#!/bin/sh\ncase "$1" in\n --version) echo "codewide-relay {self.version}";;\n status) exit 1;;\n *) exec {shlex.quote(str(DIST / ASSET))} "$@";;\nesac\n')
        self.payload.chmod(0o755)
        self.checksum()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(b"Ready:", result.stdout)
        self.assertIn(b"did not become ready", result.stderr)
        self.assertEqual(os.readlink(self.install_root / "current"), previous_generation)
        self.assertEqual(hashlib.sha256((self.bin / "codewide-relay").read_bytes()).hexdigest(), binary)
        self.assertEqual(self.identity(), identity)
        self.assert_authorized(computer)
        self.assert_ready()

    def test_failed_fresh_install_removes_failed_deployment(self):
        build_info = json.dumps({"schemaVersion": 1, "version": self.version, "build": "a" * 12, "sourceRevision": "a" * 40}, separators=(",", ":"))
        self.payload.write_text(f"#!/bin/sh\ncase \"$1\" in\n --version) echo \"codewide-relay {self.version}\";;\n build-info) echo '{build_info}';;\n *) exit 1;;\nesac\n")
        self.payload.chmod(0o755)
        self.checksum()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.unit.exists())
        self.assertFalse(os.path.lexists(self.bin / "codewide-relay"))
        self.assertFalse(os.path.lexists(self.install_root / "current"))
        self.assertFalse((self.root / "user.enabled").exists())
        self.assertFalse((self.root / "user.update.enabled").exists())
        self.assertFalse((self.root / "config/systemd/user/codewide-relay-update.service").exists())
        self.assertFalse((self.root / "config/systemd/user/codewide-relay-update.path").exists())
        self.assertFalse((self.root / "linger").exists())

    def test_existing_system_service_is_updated_without_a_second_identity(self):
        self.state = self.root / "system-state"
        system_unit = self.root / "system.service"
        self.custom_unit(system_unit)
        self.start_existing_service("system")
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
        # A machine-wide service receives no remote updates and no root updater.
        self.assertFalse((self.root / "systemd/system").exists())
        self.assertFalse((self.root / "system.update.enabled").exists())
        self.assertFalse(self.install_root.exists())
        self.assertIn(b"receives no remote updates", result.stdout)
        self.assert_ready()

    def test_system_service_migrates_to_user_scope_without_losing_identity_or_routes(self):
        fixture = self.legacy_system_migration_fixture()
        computer = self.paired_computer()
        identity = self.identity()
        env = {
            **fixture["env"],
            "CODEWIDE_RELAY_MIGRATION_INSTALLER_URL": (ROOT / "install/relay").as_uri(),
        }

        result = subprocess.run(
            ["sh", str(ROOT / "install/relay-migrate-user"), "--version", self.version],
            env=env,
            capture_output=True,
            timeout=60,
        )

        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b"Future installer runs", result.stdout)
        self.assertTrue((self.root / "sudo-used").exists())
        self.assertFalse(fixture["system_binary"].exists())
        self.assertFalse(fixture["system_unit"].exists())
        self.assertFalse(fixture["system_updater"].exists())
        self.assertFalse(fixture["system_update_service"].exists())
        self.assertFalse(fixture["system_update_path"].exists())
        backup = self.state / "system-to-user-v1"
        self.assertTrue((backup / "codewide-relay").is_file())
        self.assertTrue((backup / "codewide-relay.service").is_file())
        self.assertTrue((backup / "codewide-relay-updater").is_file())
        self.assertTrue((backup / "codewide-relay-update.service").is_file())
        self.assertTrue((backup / "codewide-relay-update.path").is_file())
        user_state_backup = Path(self.env["XDG_STATE_HOME"]) / "codewide/relay-before-system-migration"
        self.assertEqual((user_state_backup / "preexisting-marker").read_text(), "preserve me")
        self.bin = fixture["user_bin"]
        self.state = fixture["user_state"]
        self.unit = self.root / "config/systemd/user/codewide-relay.service"
        self.assertEqual(self.identity(), identity)
        self.assert_authorized(computer)
        self.assert_ready()
        self.assert_generation_active()
        resolved = subprocess.check_output(
            ["sh", "-c", "command -v codewide-relay"], env=env, text=True
        ).strip()
        self.assertEqual(resolved, str(fixture["user_bin"] / "codewide-relay"))

    def test_failed_system_to_user_migration_restores_the_system_service(self):
        fixture = self.legacy_system_migration_fixture()
        enable = subprocess.run(
            ["systemctl", "enable", "codewide-relay.service"],
            env=self.env,
            capture_output=True,
        )
        self.assertEqual(enable.returncode, 0, enable.stderr.decode())
        enable_update = subprocess.run(
            ["systemctl", "enable", "codewide-relay-update.path"],
            env=self.env,
            capture_output=True,
        )
        self.assertEqual(enable_update.returncode, 0, enable_update.stderr.decode())
        identity = self.identity()
        failing_installer = self.root / "failing-installer"
        failing_installer.write_text("#!/bin/sh\nexit 17\n")
        env = {
            **fixture["env"],
            "CODEWIDE_RELAY_MIGRATION_INSTALLER_URL": failing_installer.as_uri(),
        }

        result = subprocess.run(
            ["sh", str(ROOT / "install/relay-migrate-user")],
            env=env,
            capture_output=True,
            timeout=60,
        )

        self.assertEqual(result.returncode, 17, result.stderr.decode())
        self.assertIn(b"restoring the legacy system deployment", result.stderr)
        self.assertTrue(fixture["system_binary"].is_file())
        self.assertTrue(fixture["system_unit"].is_file())
        self.assertTrue(fixture["system_updater"].is_file())
        self.assertTrue(fixture["system_update_service"].is_file())
        self.assertTrue(fixture["system_update_path"].is_file())
        self.assertTrue((self.root / "system.enabled").exists())
        self.assertTrue((self.root / "system.update.enabled").exists())
        self.assertFalse((self.state / "system-to-user-v1").exists())
        self.assertEqual((fixture["user_state"] / "preexisting-marker").read_text(), "preserve me")
        self.assertFalse((self.root / "config/systemd/user/codewide-relay.service").exists())
        self.assertEqual(self.identity(), identity)
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
