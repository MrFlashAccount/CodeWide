#!/bin/sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    "${HOME}/.gradle/jdks/eclipse_adoptium-17-amd64-linux.2" \
    "${HOME}/android-studio/jbr" \
    "/opt/android-studio/jbr"
  do
    if [ -x "${candidate}/bin/java" ]; then
      JAVA_HOME=$candidate
      export JAVA_HOME
      break
    fi
  done
fi

if [ -z "${ANDROID_HOME:-}" ]; then
  for candidate in \
    "${HOME}/.local/share/codewide-toolchains/android-sdk" \
    "${HOME}/Android/Sdk"
  do
    if [ -d "$candidate" ]; then
      ANDROID_HOME=$candidate
      export ANDROID_HOME
      break
    fi
  done
fi

: "${JAVA_HOME:?Set JAVA_HOME to a JDK 17 installation}"
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK installation}"
ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-$ANDROID_HOME}
export ANDROID_SDK_ROOT

if [ "${1:-}" = "--" ]; then
  shift
fi

# Direct release APKs target physical Android devices. Keep the checked-in
# architecture list broad for debug/emulator builds, but avoid shipping every
# emulator ABI in the downloadable production APK. Callers can still override
# this explicitly, for example:
#   CODEWIDE_RELEASE_ARCHITECTURES=arm64-v8a,x86_64 pnpm android:gradle -- :app:assembleRelease
release_apk_requested=false
architectures_overridden=false
for argument in "$@"; do
  case "$argument" in
    assembleRelease|*:assembleRelease)
      release_apk_requested=true
      ;;
    -PreactNativeArchitectures=*)
      architectures_overridden=true
      ;;
  esac
done

if [ "$release_apk_requested" = true ] && [ "$architectures_overridden" = false ]; then
  release_architectures=${CODEWIDE_RELEASE_ARCHITECTURES:-arm64-v8a}
  set -- "-PreactNativeArchitectures=${release_architectures}" "$@"
fi

cd "${REPO_ROOT}"
pnpm --filter @codewide/android sync:assets

exec "${REPO_ROOT}/apps/android/android/gradlew" \
  -p "${REPO_ROOT}/apps/android/android" \
  "$@"
