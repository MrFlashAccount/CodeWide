#!/bin/sh
set -eu

release_tag=${1-}

if [ -z "$release_tag" ]; then
  exit 0
fi

case "$release_tag" in
  *[!A-Za-z0-9.-]*) valid=false ;;
  *)
    valid=false
    if printf '%s\n' "$release_tag" \
      | grep -Eq '^(v[0-9]+[.][0-9]+[.][0-9]+|release-[0-9]{4}-[0-9]{2}-[0-9]{2}[.][0-9]+)$'; then
      valid=true
    fi
    ;;
esac

if [ "$valid" != true ]; then
  echo "CODEWIDE_RELEASE_TAG must be v<major>.<minor>.<patch> or release-YYYY-MM-DD.N." >&2
  exit 2
fi
