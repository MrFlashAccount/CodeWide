#!/usr/bin/env python3
"""Contract tests for the release-candidate static and Expo Updates server."""

from __future__ import annotations

import base64
import gzip
import hashlib
import http.client
import importlib.util
import json
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


SCRIPT_ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "release_candidate_server", SCRIPT_ROOT / "release-candidate-server.py"
)
assert SPEC is not None and SPEC.loader is not None
SERVER_MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SERVER_MODULE
SPEC.loader.exec_module(SERVER_MODULE)


class CandidateServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(directory.cleanup)
        cls.site_root = Path(directory.name)
        (cls.site_root / "index.html").write_text("candidate", encoding="utf-8")
        cls.apk = b"candidate-apk" * 128
        (cls.site_root / "CodeWide-Preview-42.apk").write_bytes(cls.apk)
        (cls.site_root / "CodeWide-Preview-42.apk.gz").write_bytes(
            gzip.compress(cls.apk, compresslevel=9, mtime=0)
        )
        private_key = cls.site_root / "private-key.pem"
        subprocess.run(
            [
                "openssl",
                "genpkey",
                "-algorithm",
                "RSA",
                "-pkeyopt",
                "rsa_keygen_bits:2048",
                "-out",
                str(private_key),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        cls.public_key = subprocess.run(
            ["openssl", "pkey", "-in", str(private_key), "-pubout"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ).stdout
        cls.runtime = "0.0.0.0-native-42"
        cls.update_id = "8b1c9491-85e2-416b-b2e5-93b00eac2fae"
        release_root = cls.site_root / "ota" / cls.runtime / cls.update_id
        release_root.mkdir(parents=True)
        launch = b"console.log('candidate OTA');\n"
        (release_root / "entry.js").write_bytes(launch)
        manifest = {
            "assets": [],
            "createdAt": "2026-01-01T00:00:00.000Z",
            "id": cls.update_id,
            "launchAsset": {
                "hash": base64.urlsafe_b64encode(hashlib.sha256(launch).digest())
                .decode()
                .rstrip("="),
                "url": f"https://candidate.invalid/api/updates/assets/{cls.runtime}/{cls.update_id}/entry.js",
            },
            "runtimeVersion": cls.runtime,
        }
        for name, payload in [
            ("manifest", manifest),
            ("no-update", {"type": "noUpdateAvailable"}),
        ]:
            body = json.dumps(payload).encode("utf-8")
            (release_root / f"{name}.json").write_bytes(body)
            signature = subprocess.run(
                ["openssl", "dgst", "-sha256", "-sign", str(private_key)],
                input=body,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            ).stdout
            (release_root / f"{name}.sig").write_text(
                base64.b64encode(signature).decode(),
                encoding="utf-8",
            )
        (release_root / "release.json").write_text(
            json.dumps(
                {
                    "createdAt": "2026-01-01T00:00:00.000Z",
                    "runtimeVersion": cls.runtime,
                    "updateId": cls.update_id,
                }
            ),
            encoding="utf-8",
        )
        (release_root / "metadata.json").write_text(
            json.dumps(
                {"fileMetadata": {"android": {"assets": [], "bundle": "entry.js"}}}
            ),
            encoding="utf-8",
        )
        cls.server = SERVER_MODULE.CandidateServer(("127.0.0.1", 0), cls.site_root)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(
        self, path: str, headers: dict[str, str] | None = None
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        result = (
            response.status,
            {key.lower(): value for key, value in response.getheaders()},
            response.read(),
        )
        connection.close()
        return result

    def test_serves_static_candidate_files(self) -> None:
        status, _, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"candidate")

    def test_serves_precompressed_apk_when_the_client_accepts_gzip(self) -> None:
        status, headers, body = self.request(
            "/CodeWide-Preview-42.apk", {"Accept-Encoding": "gzip"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["content-encoding"], "gzip")
        self.assertEqual(headers["vary"], "Accept-Encoding")
        self.assertEqual(gzip.decompress(body), self.apk)

        identity_status, identity_headers, identity_body = self.request(
            "/CodeWide-Preview-42.apk", {"Accept-Encoding": "gzip;q=0"}
        )
        self.assertEqual(identity_status, 200)
        self.assertNotIn("content-encoding", identity_headers)
        self.assertEqual(identity_headers["vary"], "Accept-Encoding")
        self.assertEqual(identity_body, self.apk)

    def test_serves_signed_manifest_asset_and_settled_directive(self) -> None:
        headers = {
            "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
            "expo-platform": "android",
            "expo-protocol-version": "1",
            "expo-runtime-version": self.runtime,
        }
        status, response_headers, body = self.request("/api/updates", headers)
        self.assertEqual(status, 200)
        self.assertEqual(response_headers["expo-protocol-version"], "1")
        message = BytesParser(policy=default).parsebytes(
            f'Content-Type: {response_headers["content-type"]}\r\n\r\n'.encode() + body
        )
        parts = list(message.iter_parts())
        self.assertEqual(len(parts), 2)
        manifest_part = parts[0]
        manifest_body = manifest_part.get_payload(decode=True)
        assert manifest_body is not None
        manifest = json.loads(manifest_body)
        self.assertEqual(manifest["id"], self.update_id)
        signature_match = re.search(r'sig="([^"]+)"', manifest_part["expo-signature"])
        self.assertIsNotNone(signature_match)
        assert signature_match is not None
        self.verify_signature(manifest_body, signature_match.group(1))

        asset_path = urlsplit(manifest["launchAsset"]["url"]).path
        asset_status, asset_headers, asset_body = self.request(asset_path)
        self.assertEqual(asset_status, 200)
        self.assertEqual(asset_headers["content-type"], "application/javascript")
        self.assertEqual(asset_body, b"console.log('candidate OTA');\n")

        current_status, current_headers, current_body = self.request(
            "/api/updates",
            {**headers, "expo-current-update-id": self.update_id},
        )
        self.assertEqual(current_status, 200)
        current_message = BytesParser(policy=default).parsebytes(
            f'Content-Type: {current_headers["content-type"]}\r\n\r\n'.encode()
            + current_body
        )
        directive = list(current_message.iter_parts())[0]
        self.assertEqual(
            json.loads(directive.get_payload(decode=True)),
            {"type": "noUpdateAvailable"},
        )

    def test_rejects_invalid_protocol_requests_and_asset_traversal(self) -> None:
        status, _, _ = self.request(
            "/api/updates",
            {"expo-platform": "ios", "expo-runtime-version": self.runtime},
        )
        self.assertEqual(status, 400)
        traversal_status, _, _ = self.request(
            f"/api/updates/assets/{self.runtime}/{self.update_id}/../release.json"
        )
        self.assertEqual(traversal_status, 404)

    def verify_signature(self, body: bytes, signature: str) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body_path = root / "body.json"
            signature_path = root / "body.sig"
            public_key_path = root / "public.pem"
            body_path.write_bytes(body)
            signature_path.write_bytes(base64.b64decode(signature))
            public_key_path.write_bytes(self.public_key)
            result = subprocess.run(
                [
                    "openssl",
                    "dgst",
                    "-sha256",
                    "-verify",
                    str(public_key_path),
                    "-signature",
                    str(signature_path),
                    str(body_path),
                ],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout)


if __name__ == "__main__":
    unittest.main()
