-- Breakdown bill for insurance (owner, 16/11/2026 training: "surgery bill, pharmacy bill, breakdown
-- bill for insurance and discharge summary bill"). Its own number series.
-- On its own file: a new enum value can't be used inside the transaction that adds it.
alter type public.series_key add value if not exists 'breakdown_bill';
