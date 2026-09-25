#!/bin/sh
set -eu

mac_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH= cd -- "$mac_root/../.." && pwd)
version=${CODEWIDE_VERSION:-0.1.0}
build_number=${CODEWIDE_BUILD_NUMBER:-1}
public_key=${CODEWIDE_SPARKLE_PUBLIC_KEY:-}
app_dir=${CODEWIDE_APP_OUTPUT:-"$mac_root/.build/app/CodeWide.app"}

case "$app_dir" in
  /*/CodeWide.app) ;;
  *)
    echo "CODEWIDE_APP_OUTPUT must be an absolute path ending in /CodeWide.app." >&2
    exit 1
    ;;
esac
if [ "$(uname -s)" != Darwin ]; then
  echo "The macOS app must be built on macOS 26 or newer." >&2
  exit 1
fi
if [ -z "$public_key" ]; then
  echo "CODEWIDE_SPARKLE_PUBLIC_KEY is required." >&2
  exit 1
fi
if ! printf '%s\n' "$build_number" | grep -Eq '^[1-9][0-9]*([.][0-9]+){0,2}$'; then
  echo "CODEWIDE_BUILD_NUMBER must contain one to three numeric components." >&2
  exit 1
fi

if [ -n "${CODEWIDE_FFI_ARCHIVE:-}" ]; then
  ffi_archive=$CODEWIDE_FFI_ARCHIVE
else
  ffi_archive=$(CODEWIDE_CORE_VERSION="$version" "$mac_root/scripts/build-rust-ffi.sh")
fi
export CODEWIDE_FFI_ARCHIVE="$ffi_archive"

swift build --package-path "$mac_root" -c release \
  --arch arm64 --arch x86_64 --product CodeWide
swift build --package-path "$mac_root" -c release \
  --arch arm64 --arch x86_64 --product CodeWideRuntime
bin_dir=$(swift build --package-path "$mac_root" -c release \
  --arch arm64 --arch x86_64 --show-bin-path)

contents="$app_dir/Contents"
macos_dir="$contents/MacOS"
resources_dir="$contents/Resources"
frameworks_dir="$contents/Frameworks"
agents_dir="$contents/Library/LaunchAgents"
rm -rf -- "$app_dir"
mkdir -p "$macos_dir" "$resources_dir" "$frameworks_dir" "$agents_dir"

cp "$bin_dir/CodeWide" "$macos_dir/CodeWide"
cp "$bin_dir/CodeWideRuntime" "$macos_dir/CodeWideRuntime"
cp "$mac_root/Resources/Info.plist" "$contents/Info.plist"
cp "$mac_root/Resources/dev.codewide.runtime.plist" "$agents_dir/dev.codewide.runtime.plist"
cp "$repo_root/brand/macos/CodeWideMenuBarTemplate.png" "$resources_dir/CodeWideMenuBarTemplate.png"
cp "$repo_root/brand/macos/CodeWideMenuBarTemplate@2x.png" "$resources_dir/CodeWideMenuBarTemplate@2x.png"
cp "$repo_root/brand/codewide-menubar-template-64.png" "$resources_dir/CodeWideBrandMark.png"

icon_dir=$(mktemp -d "${TMPDIR:-/tmp}/codewide-icon.XXXXXX")
trap 'rm -rf -- "$icon_dir"' EXIT HUP INT TERM
cp -R "$repo_root/brand/macos/AppIcon.iconset" "$icon_dir/CodeWide.iconset"
iconutil -c icns "$icon_dir/CodeWide.iconset" -o "$resources_dir/CodeWide.icns"

sparkle_framework=
for candidate in $(find "$mac_root/.build" -type d -name Sparkle.framework -print); do
  if [ -f "$candidate/Versions/B/Sparkle" ]; then
    sparkle_framework=$candidate
    break
  fi
done
if [ -z "$sparkle_framework" ]; then
  echo "SwiftPM did not produce Sparkle.framework." >&2
  exit 1
fi
ditto "$sparkle_framework" "$frameworks_dir/Sparkle.framework"

if ! otool -l "$macos_dir/CodeWide" | grep -q '@executable_path/../Frameworks'; then
  install_name_tool -add_rpath '@executable_path/../Frameworks' "$macos_dir/CodeWide"
fi

plutil -replace CFBundleShortVersionString -string "$version" "$contents/Info.plist"
plutil -replace CFBundleVersion -string "$build_number" "$contents/Info.plist"
plutil -replace SUPublicEDKey -string "$public_key" "$contents/Info.plist"

chmod 755 "$macos_dir/CodeWide" "$macos_dir/CodeWideRuntime"
codesign --force --sign - --identifier dev.codewide.runtime "$macos_dir/CodeWideRuntime"
codesign --force --sign - --identifier dev.codewide.app "$macos_dir/CodeWide"
codesign --force --sign - "$app_dir"
codesign --verify --deep --strict --verbose=2 "$app_dir"

test ! -e "$macos_dir/codewide-companion"
test ! -e "$contents/Helpers/codewide-companion"
printf '%s\n' "$app_dir"
