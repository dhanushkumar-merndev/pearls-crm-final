#!/bin/sh
# A minimal env file for LOCAL Edge Functions while recording: local storage (Supabase's S3) only.
# No WhatsApp / Meta / email keys, so nothing can reach a real person. Prints the file path.
# The functions reach storage through a tiny relay ("pearl-s3") on the Supabase Docker network: it listens on
# 54321 and forwards to the gateway, because storage checks the signed host's port against 54321 and this
# machine's firewall blocks containers from reaching the host (host.docker.internal times out).
# Signed file links use 127.0.0.1 (the browser; the emulator via `adb reverse tcp:54321 tcp:54321`).
set -e
cd "$(dirname "$0")/../.."
OUT="${TMPDIR:-/tmp}/pearl-video-functions.env"
NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' supabase_kong_pearl-crm)
docker inspect pearl-s3 >/dev/null 2>&1 || docker run -d --rm --name pearl-s3 --network "$NET" alpine/socat \
  TCP-LISTEN:54321,fork,reuseaddr TCP:supabase_kong_pearl-crm:8000 >/dev/null
st() { pnpm exec supabase status -o env 2>/dev/null | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }
cat > "$OUT" <<ENV
STORAGE_ENDPOINT=http://pearl-s3:54321/storage/v1/s3
STORAGE_PUBLIC_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3
STORAGE_REGION=$(st S3_PROTOCOL_REGION)
STORAGE_BUCKET=pearl-files
STORAGE_ACCESS_KEY_ID=$(st S3_PROTOCOL_ACCESS_KEY_ID)
STORAGE_SECRET_ACCESS_KEY=$(st S3_PROTOCOL_ACCESS_KEY_SECRET)
STORAGE_PATH_STYLE=true
WEB_ORIGIN=http://127.0.0.1:3418,http://localhost:3418
ENV
docker exec supabase_db_pearl-crm psql -U postgres -qtAc \
  "insert into storage.buckets (id, name, public) values ('pearl-files', 'pearl-files', false) on conflict do nothing" >/dev/null
echo "$OUT"
