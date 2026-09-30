"""Run production menu fixtures with a real, isolated AppKit event loop."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import platform
import subprocess

REQUIRED_CHECKS = frozenset({
    "applicationRunning", "keyboardNavigationMatchesFixture", "keyWindow",
    "mouseOpeningHasNoControlFocus", "roundedGlassHasNoSquareWindowChrome",
    "hiddenAnchorStable", "disclosureChangesHeight", "nativeActionMenuKeepsPanelOpen",
    "nativeActionMenuRestoresKeyWindow", "primaryShortcutInvoked",
    "keyboardOpeningMatchesNavigationMode", "escapeAndQueuedResizeDoNotReopenPanel",
    "explicitReopenUsesUpdatedLayout", "oneCloseCallbackPerPresentation", "outsideClickClosesPanel",
})


def validate_report(report: object, keyboard_navigation_enabled: bool) -> None:
    """Fail closed on incomplete, malformed or unsuccessful native evidence."""
    if not isinstance(report, dict):
        raise ValueError("Native menu report must be an object")
    if report.get("keyboardNavigationEnabled") is not keyboard_navigation_enabled:
        raise ValueError("Native menu used a different keyboard-navigation mode")
    checks = report.get("checks")
    if not isinstance(checks, dict) or set(checks) != REQUIRED_CHECKS:
        raise ValueError("Native menu report does not cover every required contract")
    if any(value is not True for value in checks.values()) or report.get("failure") is not None:
        raise ValueError("Native menu interaction failed; see the fixture report above")


def main() -> None:
    if platform.system() != "Darwin":
        raise RuntimeError("Native menu interactions require macOS; Linux is not AppKit proof")
    root = Path(__file__).resolve().parents[3]
    mac_root = root / "apps/companion-macos"
    evidence = root / "test-results/macos"
    evidence.mkdir(parents=True, exist_ok=True)
    source = mac_root / "Sources/CodeWide"
    architecture = platform.machine()
    package_args = ["--package-path", str(mac_root), "--arch", architecture]
    subprocess.run(["swift", "build", *package_args, "--target", "CodeWideShared"], check=True)
    build = Path(subprocess.check_output(
        ["swift", "build", *package_args, "--show-bin-path"], text=True
    ).strip())
    shared_objects = [build / "CodeWideShared.o"]
    if not shared_objects[0].is_file():
        shared_objects = list((build / "CodeWideShared.build").glob("*.o"))
    if not shared_objects:
        raise RuntimeError("SwiftPM did not build the shared payload objects")
    binary = evidence / "menu-panel-harness"
    sources = [source / name for name in [
        "MenuBarPanel.swift", "CompanionMenuView.swift", "CompanionMenuState.swift",
        "CodeWideBrand.swift", "ShimmerText.swift",
    ]]
    subprocess.run([
        "swiftc", "-swift-version", "6", "-parse-as-library",
        "-target", f"{architecture}-apple-macosx26.0",
        "-I", str(build / "Modules"), "-I", str(build),
        *map(str, sources), str(mac_root / "Tests/MenuBarHarness/WaitForCondition.swift"),
        str(mac_root / "Tests/MenuBarHarness/main.swift"), *map(str, shared_objects),
        "-o", str(binary),
    ], check=True)
    for enabled in [False, True]:
        mode = "on" if enabled else "off"
        # A fresh report path prevents a crashed run from reusing old green JSON.
        with TemporaryDirectory(prefix="menu-panel-", dir=evidence) as temporary:
            output = Path(temporary) / "report.json"
            subprocess.run([
                str(binary), str(output), f"--keyboard-navigation={mode}"
            ], check=True, timeout=60)
            text = output.read_text()
            output.replace(evidence / f"menu-panel-lifecycle-{mode}.json")
        print(text, flush=True)
        validate_report(json.loads(text), enabled)


if __name__ == "__main__":
    main()
