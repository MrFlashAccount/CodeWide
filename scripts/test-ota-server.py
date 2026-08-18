#!/usr/bin/env python3
"""Integration check for the signed self-hosted Expo Updates endpoint."""

from __future__ import annotations

import base64
import hashlib
import http.client
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import unittest
from email.parser import BytesParser
from email.policy import default
from pathlib import Path
from urllib.parse import urlsplit


REPO_ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "build_shelf_server", REPO_ROOT / "scripts/build-shelf-server.py"
)
assert SPEC is not None and SPEC.loader is not None
SERVER_MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SERVER_MODULE
SPEC.loader.exec_module(SERVER_MODULE)


class ArtifactCatalogRetentionTest(unittest.TestCase):
    def test_prune_archive_keeps_newest_apks_and_matching_sidecars(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo_root = Path(directory)
            archive_root = repo_root / "builds/android"
            archive_root.mkdir(parents=True)
            for index in range(SERVER_MODULE.ARCHIVE_RETENTION_COUNT + 2):
                apk = archive_root / f"build-{index:02d}.apk"
                apk.write_bytes(str(index).encode())
                apk.with_suffix(".apk.json").write_text("{}\n", encoding="utf-8")
                os.utime(apk, (index, index))

            catalog = SERVER_MODULE.ArtifactCatalog(repo_root)
            catalog.prune_archive()

            expected = {
                f"build-{index:02d}.apk"
                for index in range(2, SERVER_MODULE.ARCHIVE_RETENTION_COUNT + 2)
            }
            self.assertEqual({path.name for path in archive_root.glob("*.apk")}, expected)
            self.assertEqual(
                {path.name for path in archive_root.glob("*.apk.json")},
                {f"{name}.json" for name in expected},
            )


class OtaServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        catalog = SERVER_MODULE.ArtifactCatalog(REPO_ROOT)
        ota_catalog = SERVER_MODULE.OtaCatalog(REPO_ROOT)
        cls.server = SERVER_MODULE.BuildShelfServer(("127.0.0.1", 0), catalog, ota_catalog)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, path: str, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        result = response.status, {key.lower(): value for key, value in response.getheaders()}, response.read()
        connection.close()
        return result

    def test_signed_manifest_asset_and_no_update(self) -> None:
        headers = {
            "expo-protocol-version": "1",
            "expo-platform": "android",
            "expo-runtime-version": "0.1.5-native-8",
            "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
        }
        status, response_headers, body = self.request("/api/updates", headers)
        self.assertEqual(status, 200)
        self.assertEqual(response_headers["expo-protocol-version"], "1")
        message = BytesParser(policy=default).parsebytes(
            f'Content-Type: {response_headers["content-type"]}\r\n\r\n'.encode() + body
        )
        parts = list(message.iter_parts())
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0].get_param("name", header="content-disposition"), "manifest")
        manifest_bytes = parts[0].get_payload(decode=True)
        assert manifest_bytes is not None
        manifest = json.loads(manifest_bytes)
        self.assertEqual(manifest["runtimeVersion"], "0.1.5-native-8")
        signature_header = parts[0]["expo-signature"]
        signature_match = re.search(r'sig="([^"]+)"', signature_header)
        self.assertIsNotNone(signature_match)
        self.verify_signature(manifest_bytes, signature_match.group(1))

        launch = manifest["launchAsset"]
        launch_path = urlsplit(launch["url"]).path
        asset_status, asset_headers, asset = self.request(launch_path)
        self.assertEqual(asset_status, 200)
        self.assertEqual(asset_headers["content-type"], "application/javascript")
        self.assertEqual(
            base64.urlsafe_b64encode(hashlib.sha256(asset).digest()).decode().rstrip("="),
            launch["hash"],
        )

        current_headers = {**headers, "expo-current-update-id": manifest["id"]}
        current_status, current_response_headers, current_body = self.request("/api/updates", current_headers)
        self.assertEqual(current_status, 200)
        current_message = BytesParser(policy=default).parsebytes(
            f'Content-Type: {current_response_headers["content-type"]}\r\n\r\n'.encode() + current_body
        )
        directive = list(current_message.iter_parts())[0]
        self.assertEqual(directive.get_param("name", header="content-disposition"), "directive")
        self.assertEqual(json.loads(directive.get_payload(decode=True)), {"type": "noUpdateAvailable"})

        legacy_status, legacy_response_headers, legacy_body = self.request(
            "/api/updates",
            {**headers, "expo-runtime-version": "legacy-runtime-without-a-published-update"},
        )
        self.assertEqual(legacy_status, 200)
        legacy_message = BytesParser(policy=default).parsebytes(
            f'Content-Type: {legacy_response_headers["content-type"]}\r\n\r\n'.encode() + legacy_body
        )
        legacy_directive = list(legacy_message.iter_parts())[0]
        self.assertEqual(legacy_directive.get_param("name", header="content-disposition"), "directive")
        legacy_directive_body = legacy_directive.get_payload(decode=True)
        assert legacy_directive_body is not None
        self.assertEqual(json.loads(legacy_directive_body), {"type": "noUpdateAvailable"})
        legacy_signature = re.search(r'sig="([^"]+)"', legacy_directive["expo-signature"])
        self.assertIsNotNone(legacy_signature)
        self.verify_signature(legacy_directive_body, legacy_signature.group(1))

    def verify_signature(self, body: bytes, signature: str) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body_path = root / "body.json"
            signature_path = root / "body.sig"
            public_key_path = root / "public.pem"
            body_path.write_bytes(body)
            signature_path.write_bytes(base64.b64decode(signature))
            certificate = REPO_ROOT / "apps/android/certs/certificate.pem"
            public_key = subprocess.run(
                ["openssl", "x509", "-pubkey", "-noout", "-in", str(certificate)],
                check=True,
                stdout=subprocess.PIPE,
            ).stdout
            public_key_path.write_bytes(public_key)
            verification = subprocess.run(
                [
                    "openssl", "dgst", "-sha256", "-verify", str(public_key_path),
                    "-signature", str(signature_path), str(body_path),
                ],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            self.assertEqual(verification.returncode, 0, verification.stdout)


if __name__ == "__main__":
    unittest.main()
