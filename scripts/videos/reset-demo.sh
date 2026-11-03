#!/bin/sh
# Fresh LOCAL database with the video demo data. Never run against staging/live.
set -e
cd "$(dirname "$0")/../.."
pnpm exec supabase db reset >/dev/null 2>&1
docker exec -i supabase_db_pearl-crm psql -U postgres -v ON_ERROR_STOP=1 -q < scripts/videos/demo-data.sql
docker exec -i supabase_db_pearl-crm psql -U postgres -v ON_ERROR_STOP=1 -q < scripts/videos/bdm-day.sql
# The private file bucket the local Edge Functions use (photos, selfies, prescriptions).
docker exec supabase_db_pearl-crm psql -U postgres -qtAc \
  "insert into storage.buckets (id, name, public) values ('pearl-files', 'pearl-files', false) on conflict do nothing" >/dev/null
echo "demo data loaded"
