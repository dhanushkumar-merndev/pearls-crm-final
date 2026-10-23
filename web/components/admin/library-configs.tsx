"use client";

import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { gstLabel, money, type CrudConfig, type Row } from "./crud-table";

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

const TREATMENT_CATEGORIES = ["surgery_ip", "procedure", "non_surgical", "wellness"] as const;

/** Table + form definition for each admin library page. */
export function useLibraryConfig(page: LibraryPage, lookupKind: LookupKind = "payment_mode"): CrudConfig {
  const t = useTranslations("library");
  const c = useTranslations("common");
  const yesNo = (v: unknown) => (v ? c("yes") : c("no"));

  switch (page) {
    case "services":
      return {
        table: "services",
        select: "*, category:lookup_values!services_category_id_fkey(label), doctor:doctors!services_doctor_id_fkey(full_name)",
        searchColumn: "name",
        order: [{ column: "name" }],
        hasActive: true,
        columns: [
          { key: "name", label: t("name") },
          { key: "category.label", label: t("category") },
          { key: "default_price_paise", label: t("price"), render: money("default_price_paise"), className: "text-right tabular-nums" },
          { key: "gst_rate_bp", label: t("gst"), render: (r) => gstLabel(r.gst_rate_bp) },
        ],
        fields: [
          { key: "name", label: t("name"), type: "text", required: true, maxLength: 200 },
          { key: "category_id", label: t("category"), type: "lookup", kind: "bill_category", labelPath: "category.label" },
          { key: "default_price_paise", label: t("price"), type: "money", required: true },
          { key: "gst_rate_bp", label: t("gst"), type: "gst", hint: t("gstHint") },
          { key: "sac", label: t("sac"), type: "text", maxLength: 8 },
          { key: "doctor_id", label: t("doctor"), type: "lookup", kind: "doctor", labelPath: "doctor.full_name", hint: t("doctorHint") },
          { key: "is_doctor_charge", label: t("isDoctorCharge"), type: "boolean" },
        ],
        defaults: { default_price_paise: 0, gst_rate_bp: 0 },
      };
    case "treatments":
      return {
        table: "treatment_templates",
        select: "*",
        searchColumn: "name",
        order: [{ column: "name" }],
        hasActive: true,
        columns: [
          { key: "name", label: t("name") },
          { key: "category", label: t("category"), render: (r) => t(`treatmentCategory.${r.category as string}`) },
          { key: "default_sessions", label: t("sessions"), className: "text-right" },
          { key: "default_price_paise", label: t("price"), render: money("default_price_paise"), className: "text-right tabular-nums" },
        ],
        fields: [
          { key: "name", label: t("name"), type: "text", required: true, maxLength: 200 },
          {
            key: "category",
            label: t("category"),
            type: "select",
            required: true,
            options: TREATMENT_CATEGORIES.map((v) => ({ value: v, label: t(`treatmentCategory.${v}`) })),
          },
          { key: "default_sessions", label: t("sessions"), type: "number", min: 1, max: 100, required: true },
          { key: "gap_days", label: t("gapDays"), type: "int_list", hint: t("gapDaysHint") },
          { key: "session_minutes", label: t("sessionMinutes"), type: "number", min: 5, max: 600 },
          {
            key: "pricing",
            label: t("pricing"),
            type: "select",
            required: true,
            options: [
              { value: "package", label: t("pricingPackage") },
              { value: "per_session", label: t("pricingPerSession") },
            ],
          },
          { key: "default_price_paise", label: t("price"), type: "money", required: true },
          { key: "follow_up_days", label: t("followUpDays"), type: "number", min: 0, max: 3650 },
          { key: "pre_care", label: t("preCare"), type: "textarea", maxLength: 4000 },
          { key: "post_care", label: t("postCare"), type: "textarea", maxLength: 4000 },
        ],
        defaults: { category: "procedure", default_sessions: 1, gap_days: [0], pricing: "package", default_price_paise: 0 },
      };
    case "rooms":
      return {
        table: "room_types",
        select: "*",
        searchColumn: "name",
        order: [{ column: "name" }],
        hasActive: true,
        columns: [
          { key: "name", label: t("name") },
          { key: "daily_rate_paise", label: t("dailyRate"), render: money("daily_rate_paise"), className: "text-right tabular-nums" },
          { key: "gst_rate_bp", label: t("gst"), render: (r) => gstLabel(r.gst_rate_bp) },
        ],
        fields: [
          { key: "name", label: t("name"), type: "text", required: true, maxLength: 120 },
          { key: "daily_rate_paise", label: t("dailyRate"), type: "money", required: true },
          { key: "gst_rate_bp", label: t("gst"), type: "gst", hint: t("roomGstHint") },
          { key: "sac", label: t("sac"), type: "text", maxLength: 8 },
        ],
        defaults: { daily_rate_paise: 0, gst_rate_bp: 0 },
      };
    case "medicines":
      return {
        table: "pharmacy_items",
        select: "*",
        searchColumn: "name",
        order: [{ column: "name" }],
        hasActive: true,
        columns: [
          { key: "name", label: t("name") },
          { key: "strength", label: t("strength") },
          { key: "form", label: t("form") },
          { key: "selling_price_paise", label: t("sellingPrice"), render: money("selling_price_paise"), className: "text-right tabular-nums" },
          { key: "gst_rate_bp", label: t("gst"), render: (r) => gstLabel(r.gst_rate_bp) },
        ],
        fields: [
          { key: "name", label: t("name"), type: "text", required: true, maxLength: 200 },
          { key: "strength", label: t("strength"), type: "text", maxLength: 60 },
          { key: "form", label: t("form"), type: "text", maxLength: 40, hint: t("formHint") },
          { key: "manufacturer", label: t("manufacturer"), type: "text", maxLength: 120 },
          { key: "hsn", label: t("hsn"), type: "text", maxLength: 8 },
          { key: "gst_rate_bp", label: t("gst"), type: "gst" },
          { key: "mrp_paise", label: t("mrp"), type: "money", required: true },
          { key: "selling_price_paise", label: t("sellingPrice"), type: "money", required: true, hint: t("sellingPriceHint") },
          { key: "purchase_price_paise", label: t("purchasePrice"), type: "money" },
          { key: "pack_size", label: t("packSize"), type: "number", min: 1 },
          { key: "sell_unit", label: t("sellUnit"), type: "text", maxLength: 20, hint: t("sellUnitHint") },
          { key: "reorder_level", label: t("reorderLevel"), type: "number", min: 0, step: 0.001 },
          { key: "rack", label: t("rack"), type: "text", maxLength: 40 },
        ],
        defaults: { mrp_paise: 0, selling_price_paise: 0, purchase_price_paise: 0, pack_size: 1, sell_unit: "unit", reorder_level: 0, gst_rate_bp: 0 },
      };
    case "lists":
      return {
        table: "lookup_values",
        select: "*",
        searchColumn: "label",
        order: [{ column: "sort" }, { column: "label" }],
        where: { kind: lookupKind },
        hasActive: true,
        columns: [
          { key: "label", label: t("label") },
          { key: "usage_count", label: t("timesUsed"), className: "text-right tabular-nums" },
          { key: "created_on_the_fly", label: t("addedOnTheFly"), render: (r) => yesNo(r.created_on_the_fly) },
        ],
        fields: [
          { key: "label", label: t("label"), type: "text", required: true, maxLength: 120 },
          { key: "sort", label: t("sort"), type: "number", min: 0, max: 10000, hint: t("sortHint") },
        ],
        defaults: { sort: 100 },
      };
    case "doctors":
      return {
        table: "doctors",
        select: "*",
        searchColumn: "full_name",
        order: [{ column: "sort" }, { column: "full_name" }],
        hasActive: true,
        columns: [
          { key: "full_name", label: t("doctorName") },
          { key: "specialization", label: t("specialization") },
          { key: "consultation_fee_paise", label: t("fee"), render: money("consultation_fee_paise"), className: "text-right tabular-nums" },
        ],
        fields: [
          { key: "full_name", label: t("doctorName"), type: "text", required: true, maxLength: 120, hint: t("doctorNameHint") },
          { key: "display_name", label: t("displayName"), type: "text", maxLength: 60, hint: t("displayNameHint") },
          { key: "specialization", label: t("specialization"), type: "text", maxLength: 120 },
          { key: "qualification", label: t("qualification"), type: "text", maxLength: 200 },
          { key: "designation", label: t("designation"), type: "text", maxLength: 120 },
          { key: "reg_council", label: t("regCouncil"), type: "text", maxLength: 120 },
          { key: "reg_number", label: t("regNumber"), type: "text", maxLength: 60 },
          { key: "consultation_fee_paise", label: t("fee"), type: "money", required: true },
          { key: "slot_minutes", label: t("slotMinutes"), type: "number", min: 5, max: 240, hint: t("slotMinutesHint") },
          { key: "capacity_override", label: t("capacity"), type: "number", min: 1, max: 50, hint: t("capacityHint") },
          { key: "colour_slot", label: t("colour"), type: "number", min: 0, max: 7, hint: t("colourHint") },
          { key: "sort", label: t("sort"), type: "number", min: 0, max: 10000, hint: t("sortHint") },
        ],
        defaults: { consultation_fee_paise: 0, colour_slot: 0, sort: 100 },
        rowActions: (row: Row) => (
          <Button asChild variant="ghost">
            <Link href={`/admin/doctors/${row.id}`}>
              <CalendarClock aria-hidden />
              {t("hoursAndLeave")}
            </Link>
          </Button>
        ),
      };
    case "holidays":
      return {
        table: "holidays",
        select: "*",
        searchColumn: "name",
        order: [{ column: "day", ascending: false }],
        columns: [
          { key: "day", label: t("date"), render: (r) => String(r.day).split("-").reverse().join("/") },
          { key: "name", label: t("holidayName") },
        ],
        fields: [
          { key: "day", label: t("date"), type: "date", required: true },
          { key: "name", label: t("holidayName"), type: "text", required: true, maxLength: 120 },
        ],
      };
  }
}
