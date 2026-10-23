// Plain module (no "use client"): the server page validates ?tab= with this list.
export const PHARMACY_TABS = ["stock", "purchases", "suppliers", "alerts"] as const;
export type PharmacyTab = (typeof PHARMACY_TABS)[number];
