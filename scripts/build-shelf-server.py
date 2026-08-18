#!/usr/bin/env python3
"""Serve Android build artifacts through a compact, resumable build shelf."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import shutil
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote, unquote, urlsplit


APK_MIME = "application/vnd.android.package-archive"
CHUNK_SIZE = 1024 * 1024
ARCHIVE_RETENTION_COUNT = 8
SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")
RANGE_PATTERN = re.compile(r"^bytes=(\d*)-(\d*)$")
SAFE_OTA_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def safe_filename(value: str) -> str:
    cleaned = SAFE_FILENAME.sub("-", value).strip("-.")
    return cleaned or "build.apk"


def human_size(size: int) -> str:
    value = float(size)
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if value < 1024 or unit == "ГБ":
            precision = 0 if unit in {"Б", "КБ"} else 1
            return f"{value:.{precision}f} {unit}"
        value /= 1024
    return f"{size} Б"


@dataclass(frozen=True)
class Artifact:
    path: Path
    artifact_id: str
    sha256: str
    filename: str
    variant: str
    version_name: str
    version_code: int | None
    created_at: float
    size: int
    archived: bool

    @property
    def download_name(self) -> str:
        version = safe_filename(self.version_name or "dev")
        variant = safe_filename(self.variant)
        return f"CodeWide-{version}-{variant}-{self.sha256[:8]}.apk"

    def as_json(self, *, latest: bool) -> dict[str, object]:
        return {
            "id": self.artifact_id,
            "filename": self.download_name,
            "sourceFilename": self.filename,
            "variant": self.variant,
            "versionName": self.version_name,
            "versionCode": self.version_code,
            "createdAt": datetime.fromtimestamp(
                self.created_at, tz=timezone.utc
            ).isoformat(),
            "size": self.size,
            "sizeLabel": human_size(self.size),
            "sha256": self.sha256,
            "latest": latest,
            "archived": self.archived,
            "downloadUrl": f"/download/{self.artifact_id}/{quote(self.download_name)}",
        }


class ArtifactCatalog:
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root.resolve()
        self.output_root = (
            self.repo_root / "apps/android/android/app/build/outputs/apk"
        )
        self.archive_root = self.repo_root / "builds/android"
        self.archive_root.mkdir(parents=True, exist_ok=True)
        self._hash_cache: dict[Path, tuple[int, int, str]] = {}
        self._lock = threading.RLock()
        self._snapshot_candidate_signature: tuple[int, int, int, int] | None = None

    def _digest(self, path: Path) -> str:
        stat = path.stat()
        cached = self._hash_cache.get(path)
        signature = (stat.st_mtime_ns, stat.st_size)
        if cached and cached[:2] == signature:
            return cached[2]
        digest = sha256_file(path)
        self._hash_cache[path] = (*signature, digest)
        return digest

    @staticmethod
    def _metadata_for(path: Path) -> dict[str, object]:
        sidecar = path.with_suffix(path.suffix + ".json")
        if sidecar.is_file():
            try:
                return json.loads(sidecar.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                pass

        gradle_metadata = path.parent / "output-metadata.json"
        if gradle_metadata.is_file():
            try:
                payload = json.loads(gradle_metadata.read_text(encoding="utf-8"))
                for element in payload.get("elements", []):
                    if element.get("outputFile") == path.name:
                        return {
                            "variant": payload.get("variantName", path.parent.name),
                            "versionName": element.get("versionName", "dev"),
                            "versionCode": element.get("versionCode"),
                        }
            except (OSError, json.JSONDecodeError):
                pass

        return {}

    def _candidate_paths(self) -> list[Path]:
        candidates: list[Path] = []
        candidates.extend(self.archive_root.glob("*.apk"))
        candidates.extend(self.output_root.glob("**/*.apk"))
        candidates.extend(self.repo_root.glob("CodeWide-*.apk"))
        candidates.extend(self.repo_root.glob("CodeWide-*.apk"))
        candidates.extend((self.repo_root / "test-results/apk-backups").glob("*.apk"))
        return [path.resolve() for path in candidates if path.is_file()]

    def _artifact(self, path: Path) -> Artifact:
        stat = path.stat()
        digest = self._digest(path)
        metadata = self._metadata_for(path)
        if self.output_root in path.parents:
            fallback_variant = path.parent.name
        elif self.archive_root in path.parents:
            fallback_variant = "release"
        else:
            fallback_variant = "archived"
        variant = str(metadata.get("variant") or fallback_variant)
        version_name = str(metadata.get("versionName") or "dev")
        raw_version_code = metadata.get("versionCode")
        version_code = raw_version_code if isinstance(raw_version_code, int) else None
        return Artifact(
            path=path,
            artifact_id=digest[:20],
            sha256=digest,
            filename=path.name,
            variant=variant,
            version_name=version_name,
            version_code=version_code,
            created_at=stat.st_mtime,
            size=stat.st_size,
            archived=self.archive_root in path.parents,
        )

    @staticmethod
    def _preferred(left: Artifact, right: Artifact) -> Artifact:
        def score(artifact: Artifact) -> tuple[int, int, float]:
            return (
                2 if artifact.archived else 0,
                1 if artifact.version_code is not None else 0,
                artifact.created_at,
            )

        return max((left, right), key=score)

    def list(self) -> list[Artifact]:
        with self._lock:
            deduplicated: dict[str, Artifact] = {}
            for path in self._candidate_paths():
                try:
                    artifact = self._artifact(path)
                except OSError:
                    continue
                previous = deduplicated.get(artifact.sha256)
                deduplicated[artifact.sha256] = (
                    artifact
                    if previous is None
                    else self._preferred(previous, artifact)
                )
            return sorted(
                deduplicated.values(),
                key=lambda artifact: (
                    artifact.created_at,
                    artifact.version_code or -1,
                ),
                reverse=True,
            )

    def latest(self, artifacts: list[Artifact] | None = None) -> Artifact | None:
        available = artifacts if artifacts is not None else self.list()
        releases = [artifact for artifact in available if artifact.variant == "release"]
        candidates = releases or available
        if not candidates:
            return None
        return max(
            candidates,
            key=lambda artifact: (
                artifact.version_code or -1,
                artifact.created_at,
            ),
        )

    def find(self, artifact_id: str) -> Artifact | None:
        return next(
            (artifact for artifact in self.list() if artifact.artifact_id == artifact_id),
            None,
        )

    def prune_archive(self) -> None:
        with self._lock:
            archived = sorted(
                self.archive_root.glob("*.apk"),
                key=lambda path: (path.stat().st_mtime_ns, path.name),
                reverse=True,
            )
            for stale_apk in archived[ARCHIVE_RETENTION_COUNT:]:
                stale_apk.unlink(missing_ok=True)
                stale_apk.with_suffix(".apk.json").unlink(missing_ok=True)

    def snapshot_release(self) -> Path | None:
        release = self.output_root / "release/app-release.apk"
        if not release.is_file():
            return None
        with self._lock:
            metadata_path = release.parent / "output-metadata.json"
            if not metadata_path.is_file():
                self._snapshot_candidate_signature = None
                return None
            release_stat = release.stat()
            metadata_stat = metadata_path.stat()
            candidate_signature = (
                release_stat.st_mtime_ns,
                release_stat.st_size,
                metadata_stat.st_mtime_ns,
                metadata_stat.st_size,
            )
            if candidate_signature != self._snapshot_candidate_signature:
                self._snapshot_candidate_signature = candidate_signature
                return None

            metadata = self._metadata_for(release)
            if not isinstance(metadata.get("versionCode"), int) or not metadata.get(
                "versionName"
            ):
                return None
            digest = self._digest(release)
            for archived in self.archive_root.glob("*.apk"):
                try:
                    if self._digest(archived) == digest:
                        return archived
                except OSError:
                    continue

            version_name = safe_filename(str(metadata.get("versionName") or "dev"))
            version_code = metadata.get("versionCode")
            code_label = str(version_code) if isinstance(version_code, int) else "dev"
            timestamp = datetime.fromtimestamp(release.stat().st_mtime).strftime(
                "%Y%m%d-%H%M%S"
            )
            destination = self.archive_root / (
                f"CodeWide-{version_name}-{code_label}-{timestamp}-{digest[:8]}.apk"
            )
            partial = destination.with_suffix(".apk.partial")
            shutil.copy2(release, partial)
            os.replace(partial, destination)
            destination.with_suffix(".apk.json").write_text(
                json.dumps(
                    {
                        "variant": "release",
                        "versionName": metadata.get("versionName", "dev"),
                        "versionCode": version_code,
                        "sha256": digest,
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            self.prune_archive()
            return destination


@dataclass(frozen=True)
class OtaUpdate:
    root: Path
    runtime_version: str
    update_id: str
    created_at: str
    manifest: bytes
    manifest_signature: str
    no_update_directive: bytes
    no_update_signature: str
    asset_types: dict[str, str]


class OtaCatalog:
    """Read-only catalog for atomically published, signed Expo updates."""

    def __init__(self, repo_root: Path) -> None:
        self.root = repo_root.resolve() / "builds/ota"

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
            if manifest_payload.get("id") != update_id:
                return None
            return OtaUpdate(
                root=directory.resolve(),
                runtime_version=str(release["runtimeVersion"]),
                update_id=update_id,
                created_at=str(release["createdAt"]),
                manifest=manifest,
                manifest_signature=(directory / "manifest.sig").read_text(encoding="utf-8").strip(),
                no_update_directive=(directory / "no-update.json").read_bytes(),
                no_update_signature=(directory / "no-update.sig").read_text(encoding="utf-8").strip(),
                asset_types=asset_types,
            )
        except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def list(self, runtime_version: str) -> list[OtaUpdate]:
        if not SAFE_OTA_SEGMENT.fullmatch(runtime_version):
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
            if runtime_root.is_dir() and SAFE_OTA_SEGMENT.fullmatch(runtime_root.name)
            for update in self.list(runtime_root.name)
        ]
        return max(updates, key=lambda update: update.created_at, default=None)

    def find(self, runtime_version: str, update_id: str) -> OtaUpdate | None:
        if not SAFE_OTA_SEGMENT.fullmatch(update_id):
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


INDEX_HTML = r"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0b0d0f">
  <title>CodeWide Builds</title>
  <style>
    :root { color-scheme: dark; --bg:#0b0d0f; --panel:#14171a; --panel2:#191d21; --text:#f5f7f8; --muted:#929aa3; --line:#262c31; --accent:#5878ff; --accent2:#91a5ff; --status:#55d68b; --danger:#ff7f87; }
    * { box-sizing:border-box; }
    html { background:var(--bg); }
    body { margin:0; min-height:100vh; color:var(--text); background:radial-gradient(circle at 90% -10%,rgba(88,120,255,.14),transparent 32rem),var(--bg); font:14px/1.45 Inter,Roboto,"Noto Sans",system-ui,sans-serif; }
    button,a { font:inherit; }
    .shell { width:min(760px,100%); margin:0 auto; padding:max(20px,env(safe-area-inset-top)) 16px max(28px,env(safe-area-inset-bottom)); }
    header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:18px; }
    .brand { display:flex; align-items:center; gap:10px; min-width:0; }
    .logo { display:grid; place-items:center; width:38px; height:38px; border-radius:13px; background:var(--accent); color:#f7f8fc; }
    .logo svg { width:25px; height:25px; stroke-width:3.2; }
    h1 { margin:0; font-size:18px; line-height:1.15; letter-spacing:-.02em; }
    .status { display:flex; align-items:center; gap:6px; color:var(--muted); font-size:12px; white-space:nowrap; }
    .dot { width:7px; height:7px; border-radius:50%; background:var(--status); box-shadow:0 0 0 4px rgba(85,214,139,.10); }
    .latest { position:relative; overflow:hidden; padding:18px; border-radius:22px; background:linear-gradient(145deg,#1a1f22,#121619); box-shadow:0 14px 40px rgba(0,0,0,.2); }
    .latest:after { content:""; position:absolute; width:180px; height:180px; right:-80px; top:-100px; border-radius:50%; background:rgba(85,214,139,.12); filter:blur(2px); pointer-events:none; }
    .eyebrow { display:flex; align-items:center; gap:7px; color:var(--accent); text-transform:uppercase; letter-spacing:.10em; font-size:10px; font-weight:800; }
    .latest-main { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-top:12px; }
    .version { font-size:27px; line-height:1; font-weight:800; letter-spacing:-.04em; }
    .variant { margin-top:7px; color:var(--muted); font-size:12px; }
    .primary { position:relative; z-index:1; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:0 17px; border-radius:15px; background:var(--accent); color:#f7f8fc; text-decoration:none; font-weight:800; white-space:nowrap; transition:transform .15s ease,filter .15s ease; }
    .primary:active { transform:scale(.97); }
    .primary:hover { filter:brightness(1.06); }
    .meta { display:flex; flex-wrap:wrap; gap:6px 15px; margin-top:17px; color:var(--muted); font-size:12px; }
    .meta span { display:inline-flex; align-items:center; gap:5px; }
    .section-head { display:flex; align-items:center; justify-content:space-between; margin:23px 2px 10px; }
    h2 { margin:0; font-size:13px; letter-spacing:.01em; }
    .count { color:var(--muted); font-size:12px; }
    .list { display:grid; gap:8px; }
    .build { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; padding:12px 12px 12px 14px; border-radius:17px; background:var(--panel); }
    .build-info { min-width:0; }
    .build-title { display:flex; align-items:center; gap:7px; min-width:0; font-weight:700; }
    .build-title strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .badge { flex:none; padding:2px 7px; border-radius:999px; background:rgba(122,168,255,.12); color:var(--accent2); font-size:10px; font-weight:750; }
    .badge.latest-badge { color:var(--accent); background:rgba(85,214,139,.11); }
    .build-meta { display:flex; flex-wrap:wrap; gap:4px 10px; margin-top:5px; color:var(--muted); font-size:11px; }
    .download { display:grid; place-items:center; width:40px; height:40px; border-radius:13px; background:var(--panel2); color:var(--text); text-decoration:none; }
    .download:active { transform:scale(.95); }
    .hash { font-family:"Roboto Mono","SFMono-Regular",ui-monospace,monospace; }
    .empty,.error { padding:24px; border-radius:18px; background:var(--panel); color:var(--muted); text-align:center; }
    footer { display:flex; justify-content:space-between; gap:12px; margin:16px 2px 0; color:#68717a; font-size:10px; }
    svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
    @media (max-width:480px) { .latest-main { align-items:stretch; flex-direction:column; } .primary { width:100%; } .version { font-size:25px; } .shell { padding-left:12px; padding-right:12px; } }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="brand"><div class="logo"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 14v22c0 8.7 5.6 14 14 14l8-17 8 17c8.4 0 14-5.3 14-14V14"/></svg></div><div><h1>CodeWide</h1><div class="status"><span class="dot"></span>Build shelf</div></div></div>
      <div class="status" id="refresh">Обновление…</div>
    </header>
    <section class="latest" id="latest"><div class="empty">Ищу последний билд…</div></section>
    <div class="section-head"><h2>Все билды</h2><span class="count" id="count"></span></div>
    <section class="list" id="list"></section>
    <footer><span>Проверка при открытии · затем каждые 30 мин</span><span>Range / resume включены</span></footer>
  </main>
  <script>
    const icon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg>`;
    const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
    const dateLabel = value => new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
    const versionLabel = build => build.versionName === 'dev' ? 'Development build' : `v${build.versionName}`;
    function render(data) {
      const latest = data.builds.find(build => build.latest);
      document.getElementById('count').textContent = `${data.builds.length}`;
      document.getElementById('refresh').textContent = `Обновлено ${new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`;
      if (!latest) {
        document.getElementById('latest').innerHTML = '<div class="empty">Билдов пока нет</div>';
        document.getElementById('list').innerHTML = '';
        return;
      }
      document.getElementById('latest').innerHTML = `
        <div class="eyebrow"><span class="dot"></span>Последний стабильный</div>
        <div class="latest-main"><div><div class="version">${escapeHtml(versionLabel(latest))}</div><div class="variant">${escapeHtml(latest.variant)} · code ${latest.versionCode ?? '—'}</div></div>
        <a class="primary" href="${latest.downloadUrl}" download>${icon}<span>Скачать · ${escapeHtml(latest.sizeLabel)}</span></a></div>
        <div class="meta"><span>${dateLabel(latest.createdAt)}</span><span class="hash">SHA ${latest.sha256.slice(0,12)}</span><span>Докачка поддерживается</span></div>`;
      document.getElementById('list').innerHTML = data.builds.map(build => `
        <article class="build"><div class="build-info"><div class="build-title"><strong>${escapeHtml(versionLabel(build))}</strong>${build.latest ? '<span class="badge latest-badge">Latest</span>' : `<span class="badge">${escapeHtml(build.variant)}</span>`}</div>
        <div class="build-meta"><span>${dateLabel(build.createdAt)}</span><span>${escapeHtml(build.sizeLabel)}</span><span>code ${build.versionCode ?? '—'}</span><span class="hash">${build.sha256.slice(0,8)}</span></div></div>
        <a class="download" href="${build.downloadUrl}" download title="Скачать ${escapeHtml(build.filename)}">${icon}</a></article>`).join('');
    }
    async function refresh() {
      try {
        const response = await fetch('/api/builds', {cache:'no-store'});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        render(await response.json());
      } catch (error) {
        document.getElementById('refresh').textContent = 'Нет связи';
        if (!document.querySelector('.build')) document.getElementById('list').innerHTML = `<div class="error">Не удалось загрузить список: ${escapeHtml(error.message)}</div>`;
      }
    }
    refresh(); setInterval(refresh, 30 * 60 * 1000);
  </script>
</body>
</html>
"""


class BuildShelfHandler(BaseHTTPRequestHandler):
    server_version = "CodexBuildShelf/1.0"

    @property
    def catalog(self) -> ArtifactCatalog:
        return self.server.catalog  # type: ignore[attr-defined]

    @property
    def ota_catalog(self) -> OtaCatalog:
        return self.server.ota_catalog  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} [{self.log_date_time_string()}] {fmt % args}")

    def _common_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow")

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
        self._common_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        if include_body:
            self.wfile.write(payload)

    def _send_error_json(self, status: HTTPStatus, message: str) -> None:
        payload = json.dumps({"error": message}).encode()
        self._send_bytes(payload, "application/json; charset=utf-8", status=status)

    def _build_payload(self) -> bytes:
        artifacts = self.catalog.list()
        latest = self.catalog.latest(artifacts)
        return json.dumps(
            {
                "generatedAt": datetime.now(tz=timezone.utc).isoformat(),
                "builds": [
                    artifact.as_json(latest=latest is not None and artifact.sha256 == latest.sha256)
                    for artifact in artifacts
                ],
            },
            ensure_ascii=False,
        ).encode("utf-8")

    @staticmethod
    def _parse_range(value: str, size: int) -> tuple[int, int] | None:
        if "," in value:
            return None
        match = RANGE_PATTERN.fullmatch(value.strip())
        if not match:
            return None
        start_text, end_text = match.groups()
        if not start_text:
            if not end_text:
                return None
            suffix = int(end_text)
            if suffix <= 0:
                return None
            return max(0, size - suffix), size - 1
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
        if start >= size or start > end:
            return None
        return start, min(end, size - 1)

    def _stream(self, source: BinaryIO, count: int) -> None:
        remaining = count
        while remaining > 0:
            chunk = source.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                return
            self.wfile.write(chunk)
            remaining -= len(chunk)

    def _send_artifact(self, artifact: Artifact, *, include_body: bool) -> None:
        etag = f'"sha256-{artifact.sha256}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self._common_headers()
            self.send_header("ETag", etag)
            self.end_headers()
            return

        range_header = self.headers.get("Range")
        byte_range = self._parse_range(range_header, artifact.size) if range_header else None
        if range_header and byte_range is None:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self._common_headers()
            self.send_header("Content-Range", f"bytes */{artifact.size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        start, end = byte_range or (0, artifact.size - 1)
        length = end - start + 1
        status = HTTPStatus.PARTIAL_CONTENT if byte_range else HTTPStatus.OK
        self.send_response(status)
        self._common_headers()
        self.send_header("Content-Type", mimetypes.guess_type(artifact.path.name)[0] or APK_MIME)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header(
            "Content-Disposition", f'attachment; filename="{artifact.download_name}"'
        )
        if byte_range:
            self.send_header("Content-Range", f"bytes {start}-{end}/{artifact.size}")
        self.end_headers()
        if not include_body:
            return
        try:
            with artifact.path.open("rb") as source:
                source.seek(start)
                self._stream(source, length)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_ota_multipart(
        self,
        part_name: str,
        body: bytes,
        signature: str,
        *,
        include_body: bool,
    ) -> None:
        boundary = f"codex-ota-{hashlib.sha256(body).hexdigest()[:24]}"
        signature_header = (
            f'sig="{signature}", keyid="main", alg="rsa-v1_5-sha256"'
        )
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
        part = opening + body + extensions + f"\r\n--{boundary}--\r\n".encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self._common_headers()
        self.send_header("Content-Type", f"multipart/mixed; boundary={boundary}")
        self.send_header("Content-Length", str(len(part)))
        self.send_header("Cache-Control", "private, max-age=0")
        self.send_header("expo-protocol-version", "1")
        self.send_header("expo-sfv-version", "0")
        self.end_headers()
        if include_body:
            self.wfile.write(part)

    def _send_ota_manifest(self, *, include_body: bool) -> None:
        if self.headers.get("expo-protocol-version", "1") != "1":
            self._send_error_json(HTTPStatus.BAD_REQUEST, "expo protocol version 1 required")
            return
        if self.headers.get("expo-platform") != "android":
            self._send_error_json(HTTPStatus.BAD_REQUEST, "android platform required")
            return
        runtime_version = self.headers.get("expo-runtime-version", "")
        current_update_id = self.headers.get("expo-current-update-id", "")
        update = self.ota_catalog.latest(runtime_version)
        if update is None:
            fallback = self.ota_catalog.latest_any()
            if fallback is None:
                self.log_message(
                    "OTA runtime=%s current=%s result=empty-catalog",
                    runtime_version or "-",
                    current_update_id or "embedded",
                )
                self._send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "OTA catalog is empty")
                return
            self.log_message(
                "OTA runtime=%s current=%s result=no-update-no-runtime",
                runtime_version or "-",
                current_update_id or "embedded",
            )
            self._send_ota_multipart(
                "directive",
                fallback.no_update_directive,
                fallback.no_update_signature,
                include_body=include_body,
            )
            return
        if current_update_id == update.update_id:
            self.log_message(
                "OTA runtime=%s current=%s result=no-update",
                runtime_version,
                current_update_id,
            )
            self._send_ota_multipart(
                "directive",
                update.no_update_directive,
                update.no_update_signature,
                include_body=include_body,
            )
            return
        self.log_message(
            "OTA runtime=%s current=%s result=manifest latest=%s",
            runtime_version,
            current_update_id or "embedded",
            update.update_id,
        )
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
            self._send_error_json(HTTPStatus.NOT_FOUND, "OTA asset not found")
            return
        path, content_type = asset
        payload = path.read_bytes()
        digest = hashlib.sha256(payload).hexdigest()
        self.send_response(HTTPStatus.OK)
        self._common_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("ETag", f'"sha256-{digest}"')
        self.end_headers()
        if include_body:
            self.wfile.write(payload)

    def _route(self, *, include_body: bool) -> None:
        path = unquote(urlsplit(self.path).path)
        if path == "/":
            self._send_bytes(
                INDEX_HTML.encode("utf-8"),
                "text/html; charset=utf-8",
                include_body=include_body,
            )
            return
        if path == "/healthz":
            self._send_bytes(b"ok\n", "text/plain; charset=utf-8", include_body=include_body)
            return
        if path == "/api/builds":
            self._send_bytes(
                self._build_payload(),
                "application/json; charset=utf-8",
                include_body=include_body,
            )
            return
        if path == "/api/updates":
            self._send_ota_manifest(include_body=include_body)
            return
        ota_asset_prefix = "/api/updates/assets/"
        if path.startswith(ota_asset_prefix):
            parts = path[len(ota_asset_prefix):].split("/", 2)
            if len(parts) != 3:
                self._send_error_json(HTTPStatus.NOT_FOUND, "OTA asset not found")
            else:
                self._send_ota_asset(
                    parts[0], parts[1], parts[2], include_body=include_body
                )
            return
        if path in {"/latest.apk", "/CodeWide.apk"}:
            latest = self.catalog.latest()
            if latest is None:
                self._send_error_json(HTTPStatus.NOT_FOUND, "no builds available")
            else:
                self._send_artifact(latest, include_body=include_body)
            return
        parts = path.split("/")
        if len(parts) == 4 and parts[1] == "download":
            artifact = self.catalog.find(parts[2])
            if artifact is None:
                self._send_error_json(HTTPStatus.NOT_FOUND, "build not found")
            else:
                self._send_artifact(artifact, include_body=include_body)
            return
        self._send_error_json(HTTPStatus.NOT_FOUND, "not found")

    def do_GET(self) -> None:  # noqa: N802
        self._route(include_body=True)

    def do_HEAD(self) -> None:  # noqa: N802
        self._route(include_body=False)


class BuildShelfServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self, address: tuple[str, int], catalog: ArtifactCatalog, ota_catalog: OtaCatalog
    ) -> None:
        self.catalog = catalog
        self.ota_catalog = ota_catalog
        super().__init__(address, BuildShelfHandler)


def snapshot_loop(catalog: ArtifactCatalog, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            catalog.snapshot_release()
        except OSError as error:
            print(f"snapshot failed: {error}")
        stop.wait(3)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4190)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    catalog = ArtifactCatalog(args.root)
    ota_catalog = OtaCatalog(args.root)
    catalog.snapshot_release()
    stop = threading.Event()
    watcher = threading.Thread(
        target=snapshot_loop, args=(catalog, stop), name="build-snapshot", daemon=True
    )
    watcher.start()
    server = BuildShelfServer((args.host, args.port), catalog, ota_catalog)
    print(f"CodeWide build shelf listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
