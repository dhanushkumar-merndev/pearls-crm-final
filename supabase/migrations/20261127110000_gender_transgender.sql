-- "Transgender" as a gender choice when registering a patient (owner, 27/11/2026). A new enum value
-- goes in its own migration (Postgres can't use it in the transaction that adds it). Discharge
-- summary pronouns already fall back to they/them for anything other than female/male.
alter type public.gender add value if not exists 'transgender' after 'male';
