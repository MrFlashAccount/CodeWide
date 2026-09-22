#!/bin/sh
set -eu

unit=${CODEWIDE_MEMORY_UNIT:-codewide-companion.service}
threshold_kb=${CODEWIDE_MEMORY_WARN_KB:-307200}
required_samples=${CODEWIDE_MEMORY_WARN_SAMPLES:-10}
state_home=${XDG_STATE_HOME:-"$HOME/.local/state"}
state_root="$state_home/codewide/companion"
counter_file="$state_root/memory-watch.count"
alert_file="$state_root/memory-alert.json"

mkdir -p "$state_root"
pid=$(systemctl --user show --property MainPID --value "$unit")
if [ -z "$pid" ] || [ "$pid" = 0 ] || [ ! -r "/proc/$pid/status" ]; then
  exit 0
fi

rss_kb=$(awk '$1 == "VmRSS:" { print $2; exit }' "/proc/$pid/status")
case "$rss_kb" in
  ''|*[!0-9]*) exit 0 ;;
esac

count=0
if [ -r "$counter_file" ]; then
  count=$(cat "$counter_file")
fi
case "$count" in
  ''|*[!0-9]*) count=0 ;;
esac

if [ "$rss_kb" -lt "$threshold_kb" ]; then
  if [ -e "$alert_file" ]; then
    logger --journald <<EOF
MESSAGE=CodeWide companion memory recovered below threshold
PRIORITY=5
SYSLOG_IDENTIFIER=codewide-companion-memory
CODEWIDE_RSS_KB=$rss_kb
CODEWIDE_THRESHOLD_KB=$threshold_kb
EOF
  fi
  printf '0\n' >"$counter_file"
  rm -f "$alert_file"
  exit 0
fi

count=$((count + 1))
printf '%s\n' "$count" >"$counter_file"
if [ "$count" -lt "$required_samples" ]; then
  exit 0
fi

timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"timestamp":"%s","pid":%s,"rssKiB":%s,"thresholdKiB":%s,"samples":%s}\n' \
  "$timestamp" "$pid" "$rss_kb" "$threshold_kb" "$count" >"$alert_file"

# Repeat once per sustained window so a long-running regression remains
# visible without flooding the journal every minute.
if [ $((count % required_samples)) -eq 0 ]; then
  logger --journald <<EOF
MESSAGE=CodeWide companion RSS remained above threshold
PRIORITY=4
SYSLOG_IDENTIFIER=codewide-companion-memory
CODEWIDE_RSS_KB=$rss_kb
CODEWIDE_THRESHOLD_KB=$threshold_kb
CODEWIDE_SUSTAINED_SAMPLES=$count
CODEWIDE_ALERT_FILE=$alert_file
EOF
fi
