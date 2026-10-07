#!/usr/bin/env bash
# Both native builds (iOS simulator release with autopilot, Android release
# APK) under the shared CLOCK IN native-build lock, one at a time, memory capped.
set -uo pipefail
C="/Volumes/Extreme SSD/Projects/clockin"
L="$C/.gradle.lock"
APP="$C/polaris-clockin/apps/mobile"
source "$C/env.sh"
until mkdir "$L" 2>/dev/null; do sleep 30; done
echo polaris > "$L/owner"
trap 'cd "$APP/android" && ./gradlew --stop >/dev/null 2>&1; rm -rf "$L"' EXIT
echo "$(date +%T) lock taken"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
if [ -z "${SKIP_IOS:-}" ]; then
  ( cd "$APP/ios" && EXPO_PUBLIC_CLUSTER=localnet EXPO_PUBLIC_LOCAL_HOST=127.0.0.1 EXPO_PUBLIC_AUTOPILOT=1 \
    xcodebuild -workspace Polaris.xcworkspace -scheme Polaris -configuration Release -sdk iphonesimulator \
    -destination id=D200DD2A-1D71-4B8F-9CCD-F704C251FCA7 -derivedDataPath "$CLOCKIN_DERIVED_DATA/polaris" \
    ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build > "$APP/.expo-run-xcb.log" 2>&1 )
  echo "$(date +%T) ios: $(grep -E '\*\* BUILD' "$APP/.expo-run-xcb.log")"
fi
[ -n "${SKIP_ANDROID:-}" ] && exit 0
export TMPDIR=/private/tmp/  # shared Gradle home is safe: the lock serialises builds
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
( cd "$APP/android" && EXPO_PUBLIC_CLUSTER=devnet NODE_ENV=production \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64 --no-daemon --max-workers=2 \
  "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=512m" > "$APP/.expo-run-gradle.log" 2>&1 )
echo "$(date +%T) android: $(grep -E 'BUILD (SUCCESSFUL|FAILED)' "$APP/.expo-run-gradle.log")"
