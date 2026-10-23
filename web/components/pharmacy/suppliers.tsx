"use client";

import { useTranslations } from "next-intl";
import { CrudTable, type CrudConfig } from "@/components/admin/crud-table";

/** Suppliers: reception and admin add and edit them directly (simple master data). */
export function Suppliers() {
  const t = useTranslations("pharmacy.supplier");
  const config: CrudConfig = {
    table: "suppliers",
    select: "*",
    searchColumn: "name",
    order: [{ column: "name" }],
    hasActive: true,
    columns: [
      { key: "name", label: t("name") },
      { key: "gstin", label: t("gstin") },
      { key: "phone", label: t("phone") },
      { key: "contact_name", label: t("contact") },
    ],
    fields: [
      { key: "name", label: t("name"), type: "text", required: true, maxLength: 200 },
      { key: "gstin", label: t("gstin"), type: "text", maxLength: 15, hint: t("gstinHint") },
      { key: "phone", label: t("phone"), type: "tel", maxLength: 40 },
      { key: "contact_name", label: t("contact"), type: "text", maxLength: 120 },
      { key: "address", label: t("address"), type: "textarea", maxLength: 400 },
    ],
  };
  return <CrudTable config={config} title={t("title")} addLabel={t("add")} />;
}
