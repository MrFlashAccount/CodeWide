#!/bin/sh
set -eu

mac_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH= cd -- "$mac_root/../.." && pwd)
version=${CODEWIDE_VERSION:-0.1.0}
build_number=${CODEWIDE_BUILD_NUMBER:-1}
public_key=${CODEWIDE_SPARKLE_PUBLIC_KEY:-}
host_update_public_key=${CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI:-}
host_update_key_id=${CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID:-}
app_dir=${CODEWIDE_APP_OUTPUT:-"$mac_root/.build/app/CodeWide.app"}
source_revision=${CODEWIDE_SOURCE_REVISION:-$(git -C "$repo_root" rev-parse HEAD)}
e2e_namespace=${CODEWIDE_E2E_NAMESPACE:-0}

case "$e2e_namespace" in
  0)
    app_identifier=dev.codewide.app
    runtime_identifier=dev.codewide.runtime
    runtime_mach_service=dev.codewide.runtime.control
    runtime_plist_name=dev.codewide.runtime.plist
    guardian_identifier=dev.codewide.update-guardian
    ;;
  1)
    app_identifier=dev.codewide.app.e2e
    runtime_identifier=dev.codewide.runtime.e2e
    runtime_mach_service=dev.codewide.runtime.control.e2e
    runtime_plist_name=dev.codewide.runtime.e2e.plist
    guardian_identifier=dev.codewide.update-guardian.e2e
    ;;
  *)
    echo "CODEWIDE_E2E_NAMESPACE must be 0 or 1." >&2
    exit 1
    ;;
esac

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
if ! printf '%s\n' "$host_update_public_key" | grep -Eq '^[A-Za-z0-9+/]+={0,2}$'; then
  echo "CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI must be base64 DER." >&2
  exit 1
fi
if ! printf '%s\n' "$host_update_key_id" | grep -Eq '^[A-Za-z0-9_-]{1,64}$'; then
  echo "CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID is required." >&2
  exit 1
fi
if ! printf '%s\n' "$source_revision" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "CODEWIDE_SOURCE_REVISION must be a full lowercase Git revision." >&2
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

build_product() {
  product=$1
  if [ "$e2e_namespace" = 1 ]; then
    swift build --package-path "$mac_root" -c release \
      --arch arm64 --arch x86_64 --product "$product" \
      -Xswiftc -D -Xswiftc CODEWIDE_E2E_NAMESPACE
  else
    swift build --package-path "$mac_root" -c release \
      --arch arm64 --product "$product"
  fi
}

build_product CodeWide
build_product CodeWideRuntime
build_product CodeWideUpdateGuardian
bin_dir=$(swift build --package-path "$mac_root" -c release \
  --arch arm64 --show-bin-path)

contents="$app_dir/Contents"
macos_dir="$contents/MacOS"
resources_dir="$contents/Resources"
frameworks_dir="$contents/Frameworks"
agents_dir="$contents/Library/LaunchAgents"
helpers_dir="$contents/Helpers"
updater_bootstrap_dir="$resources_dir/UpdaterBootstrap"
e2e_unregister_helper="$helpers_dir/CodeWideE2EUnregister"
rm -rf -- "$app_dir"
mkdir -p "$macos_dir" "$resources_dir" "$frameworks_dir" "$agents_dir" \
  "$helpers_dir" "$updater_bootstrap_dir"

cp "$bin_dir/CodeWide" "$macos_dir/CodeWide"
cp "$bin_dir/CodeWideRuntime" "$macos_dir/CodeWideRuntime"
cp "$bin_dir/CodeWideUpdateGuardian" "$updater_bootstrap_dir/CodeWideUpdateGuardian"
printf '{"schemaVersion":1,"keyId":"%s","publicKeySPKI":"%s"}\n' \
  "$host_update_key_id" "$host_update_public_key" > "$updater_bootstrap_dir/trust.json"
cp "$mac_root/Resources/Info.plist" "$contents/Info.plist"
runtime_plist="$agents_dir/$runtime_plist_name"
cp "$mac_root/Resources/dev.codewide.runtime.plist" "$runtime_plist"
cp "$repo_root/brand/macos/CodeWideMenuBarTemplate.png" "$resources_dir/CodeWideMenuBarTemplate.png"
cp "$repo_root/brand/macos/CodeWideMenuBarTemplate@2x.png" "$resources_dir/CodeWideMenuBarTemplate@2x.png"
cp "$repo_root/brand/codewide-menubar-template-64.png" "$resources_dir/CodeWideBrandMark.png"

# The Claude agent host as one Bun-compiled executable. The runtime finds it
# here and runs Claude without any setup; the Claude Agent SDK is not
# bundled: the runtime downloads the pinned package from npm on first start.
"$repo_root/scripts/build-claude-agent-host" bun-darwin-arm64 "$resources_dir/claude-agent-host"

icon_dir=$(mktemp -d "${TMPDIR:-/tmp}/codewide-icon.XXXXXX")
trap 'rm -rf -- "$icon_dir"' EXIT HUP INT TERM
cp -R "$repo_root/brand/macos/AppIcon.iconset" "$icon_dir/CodeWide.iconset"
iconutil -c icns "$icon_dir/CodeWide.iconset" -o "$resources_dir/CodeWide.icns"

if [ "$e2e_namespace" = 1 ]; then
  e2e_helper_source="$icon_dir/CodeWideE2EUnregister.swift"
  cat > "$e2e_helper_source" <<'SWIFT'
import Darwin
import Foundation
import ServiceManagement

@main
enum CodeWideE2EUnregister {
    static func main() async {
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        let helpers = executable.deletingLastPathComponent()
        let contents = helpers.deletingLastPathComponent()
        let infoURL = contents.appending(path: "Info.plist")
        let infoData = try? Data(contentsOf: infoURL)
        let rawInfo = infoData.flatMap {
            try? PropertyListSerialization.propertyList(from: $0, format: nil)
        }
        let bundleIdentifier = (rawInfo as? [String: Any])?["CFBundleIdentifier"] as? String
        guard executable.lastPathComponent == "CodeWideE2EUnregister",
              helpers.lastPathComponent == "Helpers",
              contents.lastPathComponent == "Contents",
              bundleIdentifier == "dev.codewide.app.e2e" else {
            FileHandle.standardError.write(Data("Refusing to unregister outside the E2E app.\n".utf8))
            exit(64)
        }
        let service = SMAppService.agent(plistName: "dev.codewide.runtime.e2e.plist")
        do {
            if service.status != .notRegistered, service.status != .notFound {
                try await service.unregister()
            }
            for _ in 0..<50 {
                if service.status == .notRegistered || service.status == .notFound {
                    return
                }
                try await Task.sleep(for: .milliseconds(100))
            }
            FileHandle.standardError.write(Data("E2E agent remains registered.\n".utf8))
            exit(1)
        } catch {
            FileHandle.standardError.write(Data("E2E agent unregister failed: \(error)\n".utf8))
            exit(1)
        }
    }
}
SWIFT
  e2e_helper_arm64="$icon_dir/CodeWideE2EUnregister-arm64"
  e2e_helper_x86_64="$icon_dir/CodeWideE2EUnregister-x86_64"
  macos_sdk=$(xcrun --sdk macosx --show-sdk-path)
  xcrun swiftc -parse-as-library -sdk "$macos_sdk" -target arm64-apple-macosx26.0 \
    "$e2e_helper_source" -o "$e2e_helper_arm64"
  xcrun swiftc -parse-as-library -sdk "$macos_sdk" -target x86_64-apple-macosx26.0 \
    "$e2e_helper_source" -o "$e2e_helper_x86_64"
  codesign --remove-signature "$e2e_helper_arm64"
  codesign --remove-signature "$e2e_helper_x86_64"
  lipo -create "$e2e_helper_arm64" "$e2e_helper_x86_64" -output "$e2e_unregister_helper"
fi

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
plutil -replace CFBundleIdentifier -string "$app_identifier" "$contents/Info.plist"
plutil -replace CodeWideSourceRevision -string "$source_revision" "$contents/Info.plist"
plutil -replace SUPublicEDKey -string "$public_key" "$contents/Info.plist"
plutil -replace Label -string "$runtime_identifier" "$runtime_plist"
plutil -replace MachServices -json "{\"$runtime_mach_service\":true}" "$runtime_plist"

chmod 755 "$macos_dir/CodeWide" "$macos_dir/CodeWideRuntime" \
  "$updater_bootstrap_dir/CodeWideUpdateGuardian"
chmod 600 "$updater_bootstrap_dir/trust.json"
codesign --force --sign - --identifier "$guardian_identifier" \
  "$updater_bootstrap_dir/CodeWideUpdateGuardian"
codesign --force --sign - --identifier "$runtime_identifier" "$macos_dir/CodeWideRuntime"
codesign --force --sign - --identifier dev.codewide.claude-agent-host \
  "$resources_dir/claude-agent-host"
if [ "$e2e_namespace" = 1 ]; then
  chmod 755 "$e2e_unregister_helper"
  codesign --force --sign - --identifier dev.codewide.e2e-unregister \
    "$e2e_unregister_helper"
  codesign --verify --strict --verbose=2 "$e2e_unregister_helper"
  codesign -d --verbose=4 "$e2e_unregister_helper" 2>&1 \
    | grep -Fx 'Identifier=dev.codewide.e2e-unregister' >/dev/null
fi
codesign --force --sign - --identifier "$app_identifier" "$macos_dir/CodeWide"
codesign --force --sign - --identifier "$app_identifier" "$app_dir"
codesign --verify --deep --strict --verbose=2 "$app_dir"

test ! -e "$macos_dir/codewide-companion"
test ! -e "$contents/Helpers/codewide-companion"
printf '%s\n' "$app_dir"
