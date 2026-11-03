#!/usr/bin/env bash
# Debug build of the phone app that talks to the LOCAL Supabase (the emulator reaches the PC at 10.0.2.2).
# The result goes to ~/Videos/pearl-crm-videos/_work/pearl-local.apk; the normal debug APK is put back as it was.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="$HOME/Videos/pearl-crm-videos/_work"
mkdir -p "$OUT"
APK=android/app/build/outputs/apk/debug/app-debug.apk
[ -f "$APK" ] && cp "$APK" "$OUT/app-debug.before-videos.apk"
ANON=$(pnpm exec supabase status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
[ -n "$ANON" ] || { echo "local Supabase is not running (pnpm db:start)"; exit 1; }
(cd android && NEXT_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" WEB_ORIGIN= \
  ./gradlew --quiet :app:assembleDebug)
cp "$APK" "$OUT/pearl-local.apk"
[ -f "$OUT/app-debug.before-videos.apk" ] && cp "$OUT/app-debug.before-videos.apk" "$APK"
echo "$OUT/pearl-local.apk"
