#!/bin/sh
# Environment for the recording copy of the web app: LOCAL Supabase only (fake data, no live WhatsApp).
export NEXT_DIST_DIR=.next-video
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(cd "$(dirname "$0")/../.." && pnpm exec supabase status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')"
export NEXT_PUBLIC_TURNSTILE_SITE_KEY=
