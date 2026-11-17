-- Security check (pnpm advisors): two helpers were created without a pinned search_path
-- (file_rule when it was recreated for day-start selfies, bb_ids for breakdown bills). Both already
-- name everything in full; pinning it keeps the rule "search_path set everywhere" (Phase 15).
alter function private.file_rule(public.file_purpose) set search_path = '';
alter function private.bb_ids(jsonb, text) set search_path = '';
