#!/usr/bin/env python3
"""Serve the CodeWide Preview APK and signed Expo Updates from one origin."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
from dataclasses import dataclass
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")


@dataclass(frozen=True)
class OtaUpdate:
    root: Path
    runtime_version: str
    update_id: str
    created_at: str
    manifest: bytes
    manifest_signature: str
    no_update: bytes
    no_update_signature: str
    asset_types: dict[str, str]


class OtaCatalog:
    def __init__(self, site_root: Path) -> None:
        self.root = site_root.resolve() / "ota"

    def _load(self, directory: Path) -> OtaUpdate | None:
        try:
            release = json.loads((directory / "release.json").read_text(encoding="utf-8"))
            manifest = (directory / "manifest.json").read_bytes()
            manifest_payload = json.loads(manifest)
            metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
            android = metadata["fileMetadata"]["android"]
            asset_types = {
                str(asset["path"]): mimetypes.types_map.get(
                    f'.{str(asset["ext"]).lower()}', "application/octet-stream"
                )
                for asset in android.get("assets", [])
            }
            asset_types[str(android["bundle"])] = "application/javascript"
            update_id = str(release["updateId"])
            runtime_version = str(release["runtimeVersion"])
            if manifest_payload.get("id") != update_id:
                return None
            if manifest_payload.get("runtimeVersion") != runtime_version:
                return None
            return OtaUpdate(
                root=directory.resolve(),
                runtime_version=runtime_version,
                update_id=update_id,
                created_at=str(release["createdAt"]),
                manifest=manifest,
                manifest_signature=(directory / "manifest.sig").read_text(encoding="utf-8").strip(),
                no_update=(directory / "no-update.json").read_bytes(),
                no_update_signature=(directory / "no-update.sig").read_text(encoding="utf-8").strip(),
                asset_types=asset_types,
            )
        except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def list(self, runtime_version: str) -> list[OtaUpdate]:
        if not SAFE_SEGMENT.fullmatch(runtime_version):
            return []
        runtime_root = self.root / runtime_version
        if not runtime_root.is_dir():
            return []
        updates = [
            update
            for directory in runtime_root.iterdir()
            if directory.is_dir() and not directory.name.startswith(".staging-")
            if (update := self._load(directory)) is not None
            and update.runtime_version == runtime_version
        ]
        return sorted(updates, key=lambda update: update.created_at, reverse=True)

    def latest(self, runtime_version: str) -> OtaUpdate | None:
        updates = self.list(runtime_version)
        return updates[0] if updates else None

    def latest_any(self) -> OtaUpdate | None:
        if not self.root.is_dir():
            return None
        updates = [
            update
            for runtime_root in self.root.iterdir()
            if runtime_root.is_dir() and SAFE_SEGMENT.fullmatch(runtime_root.name)
            for update in self.list(runtime_root.name)
        ]
        return max(updates, key=lambda update: update.created_at, default=None)

    def find(self, runtime_version: str, update_id: str) -> OtaUpdate | None:
        if not SAFE_SEGMENT.fullmatch(update_id):
            return None
        return next(
            (update for update in self.list(runtime_version) if update.update_id == update_id),
            None,
        )

    @staticmethod
    def asset(update: OtaUpdate, relative_path: str) -> tuple[Path, str] | None:
        content_type = update.asset_types.get(relative_path)
        if content_type is None:
            return None
        candidate = (update.root / relative_path).resolve()
        if candidate != update.root and update.root not in candidate.parents:
            return None
        if not candidate.is_file():
            return None
        return candidate, content_type


class CandidateHandler(SimpleHTTPRequestHandler):
    server_version = "CodeWideCandidate/1.0"

    @property
    def ota_catalog(self) -> OtaCatalog:
        return self.server.ota_catalog  # type: ignore[attr-defined]

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        super().end_headers()

    def _send_bytes(
        self,
        payload: bytes,
        content_type: str,
        *,
        status: HTTPStatus = HTTPStatus.OK,
        cache_control: str = "no-store",
        include_body: bool = True,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        if include_body:
            self.wfile.write(payload)

    def _send_error(self, status: HTTPStatus, message: str, *, include_body: bool) -> None:
        payload = json.dumps({"error": message}).encode("utf-8")
        self._send_bytes(
            payload,
            "application/json; charset=utf-8",
            status=status,
            include_body=include_body,
        )

    def _send_ota_multipart(
        self,
        part_name: str,
        body: bytes,
        signature: str,
        *,
        include_body: bool,
    ) -> None:
        boundary = f"codewide-candidate-{hashlib.sha256(body).hexdigest()[:24]}"
        signature_header = f'sig="{signature}", keyid="main", alg="rsa-v1_5-sha256"'
        opening = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{part_name}"\r\n'
            "Content-Type: application/json; charset=utf-8\r\n"
            f"expo-signature: {signature_header}\r\n\r\n"
        ).encode("utf-8")
        extensions = b""
        if part_name == "manifest":
            extensions = (
                f"\r\n--{boundary}\r\n"
                'Content-Disposition: form-data; name="extensions"\r\n'
                "Content-Type: application/json; charset=utf-8\r\n\r\n"
                '{"assetRequestHeaders":{}}'
            ).encode("utf-8")
        payload = opening + body + extensions + f"\r\n--{boundary}--\r\n".encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"multipart/mixed; boundary={boundary}")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "private, max-age=0")
        self.send_header("expo-protocol-version", "1")
        self.send_header("expo-sfv-version", "0")
        self.end_headers()
        if include_body:
            self.wfile.write(payload)

    def _send_ota_manifest(self, *, include_body: bool) -> None:
        if self.headers.get("expo-protocol-version", "1") != "1":
            self._send_error(
                HTTPStatus.BAD_REQUEST,
                "expo protocol version 1 required",
                include_body=include_body,
            )
            return
        if self.headers.get("expo-platform") != "android":
            self._send_error(
                HTTPStatus.BAD_REQUEST,
                "android platform required",
                include_body=include_body,
            )
            return
        runtime_version = self.headers.get("expo-runtime-version", "")
        current_update_id = self.headers.get("expo-current-update-id", "")
        update = self.ota_catalog.latest(runtime_version)
        if update is None:
            fallback = self.ota_catalog.latest_any()
            if fallback is None:
                self._send_error(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    "OTA catalog is empty",
                    include_body=include_body,
                )
                return
            self._send_ota_multipart(
                "directive",
                fallback.no_update,
                fallback.no_update_signature,
                include_body=include_body,
            )
            return
        if current_update_id == update.update_id:
            self._send_ota_multipart(
                "directive",
                update.no_update,
                update.no_update_signature,
                include_body=include_body,
            )
            return
        self._send_ota_multipart(
            "manifest",
            update.manifest,
            update.manifest_signature,
            include_body=include_body,
        )

    def _send_ota_asset(
        self,
        runtime_version: str,
        update_id: str,
        relative_path: str,
        *,
        include_body: bool,
    ) -> None:
        update = self.ota_catalog.find(runtime_version, update_id)
        asset = self.ota_catalog.asset(update, relative_path) if update is not None else None
        if asset is None:
            self._send_error(
                HTTPStatus.NOT_FOUND,
                "OTA asset not found",
                include_body=include_body,
            )
            return
        path, content_type = asset
        payload = path.read_bytes()
        self._send_bytes(
            payload,
            content_type,
            cache_control="public, max-age=31536000, immutable",
            include_body=include_body,
        )

    def _route_candidate(self, *, include_body: bool) -> bool:
        path = unquote(urlsplit(self.path).path)
        if path == "/healthz":
            self._send_bytes(b"ok\n", "text/plain; charset=utf-8", include_body=include_body)
            return True
        if path == "/api/updates":
            self._send_ota_manifest(include_body=include_body)
            return True
        prefix = "/api/updates/assets/"
        if path.startswith(prefix):
            parts = path[len(prefix) :].split("/", 2)
            if len(parts) != 3:
                self._send_error(
                    HTTPStatus.NOT_FOUND,
                    "OTA asset not found",
                    include_body=include_body,
                )
            else:
                self._send_ota_asset(parts[0], parts[1], parts[2], include_body=include_body)
            return True
        return False

    def do_GET(self) -> None:  # noqa: N802
        if not self._route_candidate(include_body=True):
            super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if not self._route_candidate(include_body=False):
            super().do_HEAD()


class CandidateServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], site_root: Path) -> None:
        self.site_root = site_root.resolve()
        self.ota_catalog = OtaCatalog(self.site_root)
        super().__init__(address, partial(CandidateHandler, directory=str(self.site_root)))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=4186, type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    server = CandidateServer((args.host, args.port), args.root)
    server.serve_forever()


if __name__ == "__main__":
    main()
