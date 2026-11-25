"""Linux Android lab shared by the interactive launcher and the notification smoke."""

import json
import os
import re
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LAB = Path(
    os.environ.get(
        "CODEWIDE_ANDROID_LAB",
        Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "codewide-android-lab",
    )
).resolve()
COMPILE_SDK = Path(
    os.environ.get("ANDROID_HOME", Path.home() / ".local/share/codewide-toolchains/android-sdk")
)
SDK = Path(
    os.environ.get(
        "CODEWIDE_EMULATOR_SDK", LAB / "sdk" if (LAB / "sdk/emulator/emulator").exists() else COMPILE_SDK
    )
)
AVDS = LAB / "avd"
AVD = "CodeWideAgent35"
PORT = 5584
SERIAL = f"emulator-{PORT}"
METRO = 8194
PEER = 18767
PACKAGE = "dev.codexremote.app.dev"
CLI = LAB / "tools/node_modules/.bin/agent-device"
ENV = dict(
    os.environ,
    ANDROID_HOME=str(SDK),
    ANDROID_SDK_ROOT=str(SDK),
    ANDROID_AVD_HOME=str(AVDS),
    AGENT_DEVICE_STATE_DIR=str(LAB / "callstack"),
    PATH=f"{SDK}/platform-tools:{os.environ['PATH']}",
)
JAVA = Path.home() / ".gradle/jdks/eclipse_adoptium-17-amd64-linux.2"
if "JAVA_HOME" not in ENV and JAVA.is_dir():
    ENV.update(JAVA_HOME=str(JAVA), PATH=f"{JAVA}/bin:{ENV['PATH']}")


def run(*args, env=None, timeout=60, stdin=None):
    p = subprocess.run(args, cwd=ROOT, env=env, input=stdin, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError(f"{Path(args[0]).name} exited {p.returncode}: {p.stderr.strip()[-600:]}")
    return p.stdout.strip()


def adb(*args):
    return run(SDK / "platform-tools/adb", "-s", SERIAL, *args, env=ENV)


def device(*args):
    return run(CLI, *args, "--platform", "android", "--serial", SERIAL, "--session", "codewide-lab", env=ENV)


def screen():
    return device("snapshot", "-i")


def wait_for(label, test, seconds=45):
    deadline = time.monotonic() + seconds
    last = ""
    while time.monotonic() < deadline:
        try:
            result = test()
            if result:
                return result
        except (RuntimeError, OSError) as exc:
            last = str(exc)
        time.sleep(0.45)
    raise RuntimeError(f"Timed out waiting for {label}. {last}")


def ref(snapshot, role, label):
    for line in snapshot.splitlines():
        match = re.search(r'(@e\d+) \[([^\]]+)\] "([^"]+)"', line)
        if match and match[2] == role and match[3] == label:
            return match[1]
    return None


def click(role, label, *, scroll=False):
    for attempt in range(4 if scroll else 1):
        found = ref(screen(), role, label)
        if found:
            device("click", found)
            return
        if scroll and attempt < 3:
            device("scroll", "down", "0.75")
    raise RuntimeError(f"Could not find {role} {label}")


def device_claims():
    status = run(CLI, "device", "status", "--platform", "android", "--serial", SERIAL, "--json", env=ENV)
    return json.loads(status)["data"]["claims"]


def owns_claim(claim):
    owner = claim["owner"]
    return (
        owner["session"] == "codewide-lab"
        and Path(owner["stateDir"]).resolve() == (LAB / "callstack").resolve()
        and Path(owner["workspace"]).resolve() == ROOT
    )


def launch():
    if any(not owns_claim(claim) for claim in device_claims()):
        raise RuntimeError(f"{SERIAL} is in use by another agent-device session")
    url = f"codewide://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A{METRO}"

    def open_workspace():
        adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PACKAGE)
        device("open", PACKAGE, "--foreground", "--metro-host", "127.0.0.1", "--metro-port", str(METRO))

    try:
        open_workspace()
    except RuntimeError as error:
        # After an emulator is replaced on the same serial the daemon can remember an old session
        # even though its host device claim is gone. Close only our local, unclaimed session.
        if "no longer holds the claim" not in str(error) or device_claims():
            raise
        device("close")
        open_workspace()

    def ready():
        snap = screen()
        if any(
            s in snap
            for s in ["Thread list menu", "Connect a server", "no-server-connect", "Back to settings"]
        ):
            return True
        if ref(snap, "button", "Continue"):
            click("button", "Continue")
        elif ref(snap, "button", "Close") and ("Reload" in snap or "DevTools" in snap):
            click("button", "Close")
        return False

    wait_for("CodeWide workspace", ready, 180)


def verify_avd():
    actual = adb("emu", "avd", "path").splitlines()[0]
    if Path(actual).resolve() != (AVDS / f"{AVD}.avd").resolve():
        raise RuntimeError(f"{SERIAL} belongs to a different AVD")
