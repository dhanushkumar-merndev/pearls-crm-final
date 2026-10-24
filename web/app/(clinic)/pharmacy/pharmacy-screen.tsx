"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2, PackagePlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { formatINR } from "@pearl/shared";
import { StatTile } from "@/components/kpi/stat-tile";
import { PatientPicker, type PatientHit } from "@/components/patients/patient-picker";
import { AlertsList } from "@/components/pharmacy/alerts-list";
import { PurchasesTable } from "@/components/pharmacy/purchases-table";
import { StockTable } from "@/components/pharmacy/stock-table";
import { Suppliers } from "@/components/pharmacy/suppliers";
import { PHARMACY_TABS, type PharmacyTab } from "@/components/pharmacy/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, PageHeader } from "@/components/ui/form";
import { newId, rpc } from "@/lib/rpc";
import { pickPatientSchema } from "@/lib/schemas/pharmacy";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

interface Summary {
  stock_value_paise: number;
  near_expiry_value_paise: number;
  expired_value_paise: number;
  alerts: number;
  sales_today_paise: number;
  sales_month_paise: number;
  margin_month_paise: number;
}

/** Pharmacy: stock, purchases, suppliers, alerts. One primary action: a new sale. */
export function PharmacyScreen({ initialTab }: { initialTab: PharmacyTab }) {
  const t = useTranslations("pharmacy");
  const router = useRouter();
  const [tab, setTab] = useState<PharmacyTab>(initialTab);
  const [selling, setSelling] = useState(false);
  const summary = useQuery({ queryKey: ["pharmacy_summary"], queryFn: () => rpc<Summary>("pharmacy_summary") });
  const s = summary.data;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/pharmacy/purchases/new">
                <PackagePlus aria-hidden />
                {t("newPurchase")}
              </Link>
            </Button>
            <Button onClick={() => setSelling(true)}>
              <FilePlus2 aria-hidden />
              {t("newSale")}
            </Button>
          </>
        }
      />
      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t("tile.salesToday")} value={formatINR(s.sales_today_paise)} />
          <StatTile label={t("tile.salesMonth")} value={formatINR(s.sales_month_paise)} />
          <StatTile label={t("tile.stockValue")} value={formatINR(s.stock_value_paise)} />
          <StatTile label={t("tile.nearExpiry")} value={formatINR(s.near_expiry_value_paise)} goodWhen="down" />
        </div>
      )}

      <Tabs.Root
        value={tab}
        onValueChange={(v) => {
          setTab(v as PharmacyTab);
          router.replace(`/pharmacy?tab=${v}`, { scroll: false });
        }}
        className="flex flex-col gap-4"
      >
        <Tabs.List aria-label={t("sections")} className="flex flex-wrap gap-1 border-b border-border">
          {PHARMACY_TABS.map((x) => (
            <Tabs.Trigger
              key={x}
              value={x}
              className="min-h-11 rounded-t-xl px-4 font-medium text-text-secondary hover:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-foreground data-[state=active]:text-foreground"
            >
              {t(`tab.${x}`)}
              {x === "alerts" && (s?.alerts ?? 0) > 0 && <span className="ml-1.5 tabular-nums">({s!.alerts})</span>}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="stock">
          <StockTable />
        </Tabs.Content>
        <Tabs.Content value="purchases">
          <PurchasesTable />
        </Tabs.Content>
        <Tabs.Content value="suppliers">
          <Suppliers />
        </Tabs.Content>
        <Tabs.Content value="alerts">
          <AlertsList />
        </Tabs.Content>
      </Tabs.Root>

      <Dialog open={selling} onOpenChange={setSelling}>
        {selling && <NewSaleDialog />}
      </Dialog>
    </div>
  );
}

/** A sale is a pharmacy invoice for a patient (registered first if new). */
function NewSaleDialog() {
  const t = useTranslations("pharmacy");
  const router = useRouter();
  const { failed } = useFeedback();
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [clientId] = useState(newId);
  const checks = useZodForm(pickPatientSchema);
  const create = useMutation({
    mutationFn: (patientId: string) => rpc<{ id: string }>("create_bill", { p_type: "pharmacy_invoice", p_patient_id: patientId, p_links: {}, p_client_id: clientId }),
    onSuccess: (b) => router.push(`/bills/${b.id}`),
    onError: failed,
  });
  return (
    <DialogContent
      title={t("newSale")}
      description={t("newSaleHint")}
      footer={
        <Button
          disabled={create.isPending}
          onClick={() => {
            const d = checks.validate({ patient });
            if (d) create.mutate(d.patient);
          }}
        >
          <FilePlus2 aria-hidden />
          {t("startBill")}
        </Button>
      }
    >
      <Field label={t("patient")} error={checks.error("patient")}>
        {(a) => <PatientPicker {...a} value={patient} onChange={(p) => (setPatient(p), checks.clear("patient"))} />}
      </Field>
      <p className="mt-3 text-text-secondary">
        <Link href="/patients/new" className="text-link underline-offset-4 hover:underline">
          {t("registerFirst")}
        </Link>
      </p>
    </DialogContent>
  );
}
