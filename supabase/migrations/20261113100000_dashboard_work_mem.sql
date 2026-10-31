-- Admin dashboard "money" part (31/10/2026, `pnpm perf`): the outstanding balances add up every
-- bill and payment per patient in one hash aggregate. At the default work_mem (4 MB on the free
-- plan) that spilled to disk in 5 batches on the two-year perf seed (~65 ms of the ~100 ms), and
-- the year view's p95 swung to 0.9–2.4 s when the shared disk was busy. Only for this function's
-- call (the setting ends with it); nothing else changes.
alter function public.dashboard_admin(date, date, boolean, text[]) set work_mem = '32MB';
