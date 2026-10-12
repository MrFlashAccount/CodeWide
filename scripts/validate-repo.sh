#!/bin/sh
# Repository-wide gates that no Nx project owns, run in full on every pull
# request. They are the release paths' pre-build checks outside the affected
# Nx `check`/`test`/`build` targets: a change elsewhere can break them, so they
# never run only for affected projects.
set -eu

stage() {
  printf '\n==> %s\n' "$1"
}

stage "Rust formatting"
cargo fmt --all -- --check

stage "TypeScript typecheck (scripts and workspace packages)"
pnpm typecheck

stage "Agent packages formatting and lint"
pnpm format:agents:check
pnpm lint:agents

stage "Root Vitest suite"
pnpm test

stage "Android release bundle"
pnpm --filter @codewide/android compile:android

stage "OTA server tests"
pnpm test:ota

stage "Release script tests"
sh scripts/update-homebrew-tap.test.sh
sh scripts/macos-build-version.test.sh

stage "Secret scan"
pnpm security:scan-secrets
