#!/usr/bin/env python3
"""Prove the nonce exception cannot suppress another secret on the same line."""
import argparse
import base64
import json
from pathlib import Path
import secrets
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("gitleaks", help="The repository's pinned Gitleaks binary")
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix="codewide-nonce-scan-") as directory:
    temporary = Path(directory)
    fixture = temporary / "scripts/relay-installer-service.test.py"
    fixture.parent.mkdir()
    encoded_nonce = base64.b64encode(b"installer-test!!").decode("ascii")
    nonce = 'headers = {"Sec-WebSocket-Key": "' + encoded_nonce + '"}'
    for with_fake_secret in (False, True):
        # Generated test input is not an account credential and never gets printed.
        suffix = f'; api_key = "{secrets.token_hex(24)}"' if with_fake_secret else ""
        fixture.write_text(nonce + suffix + "\n")
        report = temporary / "redacted.json"
        scanned = subprocess.run(
            [args.gitleaks, "dir", "--no-banner", "--redact", "--config", str(root / ".gitleaks.toml"),
             "--report-format", "json", "--report-path", str(report), "."],
            cwd=temporary, capture_output=True, text=True)
        expected = 1 if with_fake_secret else 0
        assert scanned.returncode == expected, "Nonce exception did not isolate the protocol field"
        findings = json.loads(report.read_text())
        assert len(findings) == expected
        if with_fake_secret:
            assert findings[0]["RuleID"] == "generic-api-key"
            assert "api_key" in findings[0]["Match"]
print("Nonce allowlist passed: public handshake nonce allowed; same-line synthetic API key still rejected.")
