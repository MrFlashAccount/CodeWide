#!/usr/bin/env python3
"""Build the smoke fixture against Cargo-selected workspace dependencies."""
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
dependencies = {"base64", "companion_core", "companion_swift_ffi", "futures_util",
                "p256", "rcgen", "rustls", "serde_json", "tokio", "tokio_tungstenite",
                "codewide_relay", "tempfile", "url"}
artifacts = {}
build = subprocess.Popen(
    ["cargo", "build", "-p", "companion-swift-ffi", "--message-format=json"],
    cwd=root, stdout=subprocess.PIPE, text=True)
for line in build.stdout:
    event = json.loads(line)
    if event.get("reason") == "compiler-artifact":
        name = event["target"]["name"]
        libraries = [path for path in event["filenames"] if path.endswith(".rlib")]
        if name in dependencies and libraries:
            artifacts[name] = libraries[0]
if build.wait() != 0:
    raise SystemExit("Workspace dependency build failed")
if dependencies != artifacts.keys():
    raise SystemExit(f"Missing built fixture dependencies: {dependencies - artifacts.keys()}")
output = root / "test-results/relay-e2e/client"
output.parent.mkdir(parents=True, exist_ok=True)
arguments = ["rustc", "--edition=2024", str(Path(__file__).with_name("client.rs")),
             "-L", f"dependency={root / 'target/debug/deps'}", "-o", str(output)]
for name, path in artifacts.items():
    arguments.extend(["--extern", f"{name}={path}"])
subprocess.run(arguments, cwd=root, check=True)
os.chmod(output, 0o755)
print(output)
