#!/usr/bin/env python3
"""Disposable KVM guest: real systemd without exposing host services or credentials.

Run inside the adjacent Dockerfile's tools image with only /dev/kvm and an
experiment directory mounted. The guest SSH and Relay forwards are container
local; publish a Relay forward on host loopback only if a client needs it.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import time


def run(arguments, **options):
    return subprocess.run(arguments, check=True, text=True, **options)


class Guest:
    def __init__(self, root):
        self.root = root
        self.options = ["-i", str(root / "ssh-key"), "-p", "2222",
                        "-o", "BatchMode=yes", "-o", "ConnectTimeout=3",
                        "-o", "StrictHostKeyChecking=accept-new",
                        "-o", f"UserKnownHostsFile={root / 'known-hosts'}"]

    def ssh(self, command, **options):
        return run(["ssh", *self.options, "relaytest@127.0.0.1", command],
                   capture_output=True, timeout=180, **options).stdout

    def ready(self):
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            result = subprocess.run(
                ["ssh", *self.options, "relaytest@127.0.0.1", "test -e /var/lib/cloud/instance/boot-finished"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                return
            time.sleep(1)
        raise RuntimeError("Isolated guest did not finish booting")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/experiment"))
    parser.add_argument("--installer", default="https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/relay")
    parser.add_argument("--version", required=True)
    parser.add_argument("--download-base", default="")
    parser.add_argument("--hold", action="store_true", help="Keep this guest available for external client tests")
    parser.add_argument("--resume", action="store_true", help="Reuse only this experiment's existing guest disk")
    args = parser.parse_args()
    root = args.root
    root.mkdir(exist_ok=True)
    os.chmod(root, 0o700)
    base = root / "ubuntu.img"
    if not base.exists():
        base_url = "https://cloud-images.ubuntu.com/minimal/releases/noble/release/"
        name = "ubuntu-24.04-minimal-cloudimg-amd64.img"
        run(["curl", "-fLSs", "--retry", "3", base_url + name, "-o", str(base)])
        checksums = run(["curl", "-fLSs", base_url + "SHA256SUMS"], capture_output=True).stdout
        expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1].lstrip("*") == name)
        with base.open("rb") as artifact:
            actual = hashlib.file_digest(artifact, "sha256").hexdigest()
        if actual != expected:
            raise RuntimeError("Ubuntu cloud image checksum mismatch")
        print(json.dumps({"cloud_image_sha256": actual}), flush=True)
    if not args.resume:
        if (root / "guest.qcow2").exists() or (root / "ssh-key").exists():
            raise RuntimeError("Refusing to overwrite existing experiment state; use a fresh directory or --resume")
        run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(root / "ssh-key")])
        public_key = (root / "ssh-key.pub").read_text().strip()
        (root / "user-data").write_text(
            "#cloud-config\nusers:\n  - name: relaytest\n    shell: /bin/bash\n"
            "    sudo: ALL=(ALL) NOPASSWD:ALL\n    ssh_authorized_keys:\n"
            f"      - {public_key}\npackage_update: true\npackages: [curl, ca-certificates, dbus-user-session]\n")
        (root / "meta-data").write_text("instance-id: codewide-relay-isolated\nlocal-hostname: relay-e2e\n")
        run(["cloud-localds", str(root / "seed.iso"), str(root / "user-data"), str(root / "meta-data")])
        run(["qemu-img", "create", "-f", "qcow2", "-F", "qcow2", "-b", str(base), str(root / "guest.qcow2"), "12G"])
    serial = (root / "serial.log").open("w")
    vm = subprocess.Popen([
        "qemu-system-x86_64", "-enable-kvm", "-cpu", "host", "-m", "1536", "-smp", "2",
        "-drive", f"file={root / 'guest.qcow2'},if=virtio,format=qcow2",
        "-drive", f"file={root / 'seed.iso'},media=cdrom,readonly=on",
        "-netdev", "user,id=net,hostfwd=tcp:127.0.0.1:2222-:22,hostfwd=tcp:0.0.0.0:18780-:8780",
        "-device", "virtio-net-pci,netdev=net", "-nographic", "-monitor", "none"],
        stdin=subprocess.DEVNULL, stdout=serial, stderr=serial)
    guest = Guest(root)
    results = {"environment": "Ubuntu 24.04 disposable KVM VM with real systemd", "expected_version": args.version}
    try:
        guest.ready()
        print("Guest ready; installing as a fresh non-root user", flush=True)
        if args.installer.startswith("https://"):
            install = f"curl -fsSL {shlex.quote(args.installer)} | sh"
        else:
            content = Path(args.installer).read_text()
            guest.ssh('umask 077; tee "$HOME/install-relay" >/dev/null', input=content)
            environment = f"CODEWIDE_RELAY_VERSION={shlex.quote(args.version)} "
            if args.download_base:
                environment += f"CODEWIDE_RELAY_DOWNLOAD_BASE_URL={shlex.quote(args.download_base)} "
            install = environment + 'sh "$HOME/install-relay"'
        output = guest.ssh(install)
        if "Ready: codewide-relay pair" not in output:
            raise AssertionError("Installer did not report usable autostart")
        print(output, flush=True)
        assert guest.ssh("codewide-relay --version").strip() == f"codewide-relay {args.version}"
        status = json.loads(guest.ssh("codewide-relay status --json"))
        assert status["port"] == 8780 and status["routes"] == []
        assert guest.ssh("systemctl --user is-active codewide-relay").strip() == "active"
        assert guest.ssh("loginctl show-user relaytest -p Linger --value").strip() == "yes"
        state = "$HOME/.local/state/codewide/relay"
        fingerprint_command = f"sha256sum {state}/transport-cert.der {state}/transport-key.der"
        before = guest.ssh(fingerprint_command)
        results["public_install_and_automatic_start"] = args.installer.startswith("https://")
        results["candidate_install_and_automatic_start"] = not args.installer.startswith("https://")
        # No SSH session remains open between these calls: linger must retain the service.
        assert guest.ssh("codewide-relay status --json")
        results["survives_logout"] = True
        boot_id = guest.ssh("cat /proc/sys/kernel/random/boot_id").strip()
        guest.ssh("sudo systemctl reboot")
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                new_boot = guest.ssh("cat /proc/sys/kernel/random/boot_id").strip()
                if new_boot != boot_id:
                    guest.ssh("timeout 30 sh -c 'until codewide-relay status --json >/dev/null; do sleep 1; done'")
                    break
            except subprocess.CalledProcessError:
                pass
            time.sleep(1)
        else:
            raise AssertionError("Guest did not reboot with a ready Relay")
        assert guest.ssh(fingerprint_command) == before
        results["real_reboot_keeps_identity_and_autostart"] = True
        (root / "results.json").write_text(json.dumps(results, indent=2) + "\n")
        print(json.dumps(results), flush=True)
        if args.hold:
            print("Guest held for client, upgrade and rollback experiments", flush=True)
            while True:
                if vm.poll() is not None:
                    raise RuntimeError("Guest stopped during client experiments")
                time.sleep(10)
    finally:
        vm.terminate()
        try:
            vm.wait(timeout=10)
        except subprocess.TimeoutExpired:
            vm.kill()
            vm.wait()
        serial.close()


if __name__ == "__main__":
    main()
