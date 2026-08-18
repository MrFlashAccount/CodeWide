#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
binary="$repo_root/target/release/codewide-host-rs"
unit_source="$repo_root/apps/host-companion-rs/deploy/codewide-host-rust-shadow.service"
install_root="${XDG_DATA_HOME:-$HOME/.local/share}/codewide-rust"
binary_root="$HOME/.local/lib/codewide-rust"
unit_root="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

test -x "$binary"
mkdir -p "$binary_root" "$unit_root" "$install_root"
install -m 0755 "$binary" "$binary_root/codewide-host-rs"
install -m 0644 "$unit_source" "$unit_root/codewide-host-rust-shadow.service"
systemctl --user daemon-reload
systemctl --user enable codewide-host-rust-shadow.service
systemctl --user restart codewide-host-rust-shadow.service
