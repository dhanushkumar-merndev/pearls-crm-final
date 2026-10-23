// Plain module (no "use client"): server pages import these to validate the URL.
// A constant exported from a client module reaches a server component as a reference,
// not as the array, so it must live here.
export const LIBRARY_PAGES = ["services", "treatments", "rooms", "medicines", "lists", "doctors", "holidays"] as const;
export type LibraryPage = (typeof LIBRARY_PAGES)[number];

export const LOOKUP_KINDS = [
  "payment_mode",
  "bill_category",
  "lead_source",
  "lost_reason",
  "referral_name",
  "relation",
  "document_kind",
  "quick_reply",
  "break_type",
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];
