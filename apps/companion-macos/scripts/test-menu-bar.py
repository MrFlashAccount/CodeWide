"""Run the AppKit event loop for keyboard/menu lifecycle tests, without services."""
from pathlib import Path
import json
import platform
import subprocess

root = Path(__file__).resolve().parents[3]
mac_root = root / "apps/companion-macos"
evidence = root / "test-results/macos"
evidence.mkdir(parents=True, exist_ok=True)
source = root / "apps/companion-macos/Sources/CodeWide"
subprocess.run(["swift", "build", "--package-path", str(mac_root), "--target", "CodeWideShared"], check=True)
build = Path(subprocess.check_output(["swift", "build", "--package-path", str(mac_root), "--show-bin-path"], text=True).strip())
shared_objects = [build / "CodeWideShared.o"]
if not shared_objects[0].is_file():
    shared_objects = list((build / "CodeWideShared.build").glob("*.o"))
assert shared_objects, "SwiftPM did not build the shared payload objects"
binary = evidence / "menu-panel-harness"
sources = [source / name for name in ["MenuBarPanel.swift", "CompanionMenuView.swift", "CompanionMenuState.swift",
                                      "CodeWideBrand.swift", "ShimmerText.swift"]]
subprocess.run(["swiftc", "-swift-version", "6", "-parse-as-library", "-target", f"{platform.machine()}-apple-macosx26.0", "-I", str(build),
                *map(str, sources), str(mac_root / "Tests/MenuBarHarness/main.swift"), *map(str, shared_objects),
                "-o", str(binary)], check=True)
subprocess.run([str(binary), str(evidence / "menu-panel-lifecycle.json")], check=True, timeout=20)
print((evidence / "menu-panel-lifecycle.json").read_text())
assert all(json.loads((evidence / "menu-panel-lifecycle.json").read_text()).values())
