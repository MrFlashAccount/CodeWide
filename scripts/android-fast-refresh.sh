#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DATA_HOME=${XDG_DATA_HOME:-${HOME}/.local/share}
OTA_PRIVATE_KEY=${CODEWIDE_OTA_PRIVATE_KEY:-${DATA_HOME}/codewide/ota/private-key.pem}
METRO_URL=${CODEWIDE_METRO_URL:-}
ZROK_SHARE=${CODEWIDE_ZROK_SHARE:-${CODEWIDE_METRO_SHARE:-codewide-metro}}
ZROK_SHARE_BIN=${CODEWIDE_ZROK_SHARE_BIN:-}
BOOTSTRAP_PID=

: "${METRO_URL:?Set CODEWIDE_METRO_URL to the public HTTPS Metro endpoint}"
if [ -n "$ZROK_SHARE_BIN" ] && [ ! -x "$ZROK_SHARE_BIN" ]; then
  echo "zrok share helper not found: $ZROK_SHARE_BIN" >&2
  exit 1
fi
if [ ! -r "$OTA_PRIVATE_KEY" ]; then
  echo "OTA signing key not readable; set CODEWIDE_OTA_PRIVATE_KEY" >&2
  exit 1
fi

# A tunnel helper is optional. Without one, the caller owns the HTTPS tunnel
# named by CODEWIDE_METRO_URL. This keeps machine-specific tunnel credentials
# and hostnames outside the repository.
if [ -n "$ZROK_SHARE_BIN" ] && ! "$ZROK_SHARE_BIN" status "$ZROK_SHARE" 2>/dev/null | grep -q '^State: running$'; then
  if command -v ss >/dev/null 2>&1 && ss -H -ltn 'sport = :8081' | grep -q .; then
    echo "port 8081 is occupied but the Metro share is not healthy" >&2
    exit 1
  fi
  python3 -m http.server 8081 --bind ::1 >/dev/null 2>&1 &
  BOOTSTRAP_PID=$!
  trap 'test -z "$BOOTSTRAP_PID" || kill "$BOOTSTRAP_PID" 2>/dev/null || true' EXIT INT TERM
  for _attempt in 1 2 3 4 5 6 7 8 9 10; do
    curl -gfsS 'http://[::1]:8081/' >/dev/null 2>&1 && break
    sleep 0.1
  done
  "$ZROK_SHARE_BIN" start "$ZROK_SHARE" 'http://[::1]:8081' --probe-path /status --safe
  kill "$BOOTSTRAP_PID" 2>/dev/null || true
  wait "$BOOTSTRAP_PID" 2>/dev/null || true
  BOOTSTRAP_PID=
fi

echo "Wireless Fast Refresh: $METRO_URL"
echo "Open: codewide://expo-development-client/?url=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$METRO_URL")"
cd "$REPO_ROOT"
EXPO_PACKAGER_PROXY_URL="$METRO_URL" exec pnpm --filter @codewide/android exec expo start \
  --dev-client \
  --localhost \
  --private-key-path "$OTA_PRIVATE_KEY" \
  "$@"
