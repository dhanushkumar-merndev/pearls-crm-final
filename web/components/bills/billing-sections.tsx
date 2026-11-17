"use client";

import { FilePlus2, FileSpreadsheet, FileText, Pill } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { BreakdownTable } from "@/components/breakdown/breakdown-table";
import { NewBreakdownDialog } from "@/components/breakdown/new-breakdown-dialog";
import { DischargeSummariesTable, NewSummaryDialog } from "@/components/discharge/discharge-summaries-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlParam } from "@/lib/use-url-param";
import { BillsTable } from "./bills-table";
import { NewBillDialog } from "./new-bill-dialog";
import type { BillType } from "./types";

export const BILLING_SECTIONS = ["surgery", "pharmacy", "breakdown", "discharge"] as const;
export type BillingSection = (typeof BILLING_SECTIONS)[number];

const SURGERY: BillType[] = ["procedure_receipt", "final_bill"];
const PHARMACY: BillType[] = ["pharmacy_invoice"];

/**
 * The clinic's four billing sections (owner, 17/11/2026): Surgery bills (with the IP final bill),
 * Pharmacy bills, Breakdown bills for insurance, and Discharge summaries. The chosen one stays in
 * the address (`?section=`). With patientId: that patient's papers, each section with its "New …".
 */
export function BillingSections({ patientId }: { patientId?: string }) {
  const t = useTranslations("bills");
  const isSection = useCallback((v: string): v is BillingSection => (BILLING_SECTIONS as readonly string[]).includes(v), []);
  const [section, setSection] = useUrlParam<BillingSection>("section", "surgery", isSection);
  const [making, setMaking] = useState<BillingSection | null>(null);
  const close = () => setMaking(null);

  const newButton = (s: BillingSection) => {
    if (!patientId) return null;
    const [Icon, label] =
      s === "surgery" ? [FilePlus2, t("newBill")] : s === "pharmacy" ? [Pill, t("newPharmacyBill")] : s === "breakdown" ? [FileSpreadsheet, t("newBreakdown")] : [FileText, t("newDischarge")];
    return (
      <Button onClick={() => setMaking(s)}>
        <Icon aria-hidden />
        {label}
      </Button>
    );
  };

  return (
    <Tabs value={section} onValueChange={(v) => isSection(v) && setSection(v)} className="flex flex-col gap-3">
      <TabsList aria-label={t("sectionsLabel")}>
        {BILLING_SECTIONS.map((s) => (
          <TabsTrigger key={s} value={s}>
            {t(`sections.${s}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {BILLING_SECTIONS.map((s) => (
        <TabsContent key={s} value={s} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.95rem] text-text-secondary">{t(`sectionHint.${s}`)}</p>
            {newButton(s)}
          </div>
          {s === "surgery" && <BillsTable patientId={patientId} types={SURGERY} />}
          {s === "pharmacy" && <BillsTable patientId={patientId} types={PHARMACY} />}
          {s === "breakdown" && <BreakdownTable patientId={patientId} />}
          {s === "discharge" && <DischargeSummariesTable patientId={patientId} />}
        </TabsContent>
      ))}
      {patientId && (
        <Dialog open={making !== null} onOpenChange={(o) => !o && close()}>
          {making === "surgery" && <NewBillDialog patientId={patientId} type="procedure_receipt" onDone={close} />}
          {making === "pharmacy" && <NewBillDialog patientId={patientId} type="pharmacy_invoice" onDone={close} />}
          {making === "breakdown" && <NewBreakdownDialog patientId={patientId} onDone={close} />}
          {making === "discharge" && <NewSummaryDialog patientId={patientId} onDone={close} />}
        </Dialog>
      )}
    </Tabs>
  );
}
